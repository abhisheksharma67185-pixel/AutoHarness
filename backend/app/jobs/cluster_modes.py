import uuid
import numpy as np
from datetime import datetime
from typing import Dict, Any, List
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from sklearn.decomposition import PCA
from sklearn.cluster import HDBSCAN

from app.core.logging import get_logger
from app.db.session import SessionLocal
from app.domain.models import Job, Run, RunTask, FailureLabel, FailureLabelEmbedding, FailureMode, FailureModeMember
from app.core.llm_client import llm_client

log = get_logger(__name__)

# Instrumentation / Metrics
clustering_runs_counter = 0
clustering_failures_counter = 0

class FailureModeLLM(BaseModel):
    name: str = Field(..., min_length=3, max_length=80)
    description: str = Field(..., min_length=20, max_length=600)

def cluster_failure_modes(
    db: Session,
    benchmark_slug: str,
    run_ids: List[str] | None = None,
    embedding_model: str | None = None,
    min_cluster_size: int = 3,
    cluster_algo: str = "hdbscan_v1",
    prompt_version: str = "mode_v1",
    is_preview: bool = False
) -> Dict[str, Any]:
    global clustering_runs_counter, clustering_failures_counter
    clustering_runs_counter += 1

    try:
        model_name = embedding_model or llm_client.model

        # 1. Fetch target run IDs
        run_query = db.query(Run).filter(Run.benchmark_slug == benchmark_slug)
        if run_ids:
            run_query = run_query.filter(Run.id.in_(run_ids))
        runs = run_query.all()
        target_run_ids = [r.id for r in runs]

        if not target_run_ids:
            raise ValueError(f"No runs found for benchmark_slug: {benchmark_slug}")

        # 2. Fetch failure labels and their embeddings
        labels = (
            db.query(FailureLabel)
            .filter(FailureLabel.run_id.in_(target_run_ids))
            .all()
        )

        valid_labels_and_embs = []
        for l in labels:
            emb_record = db.query(FailureLabelEmbedding).filter(
                FailureLabelEmbedding.failure_label_id == l.id,
                FailureLabelEmbedding.model == model_name
            ).first()
            if emb_record and emb_record.embedding:
                emb = emb_record.embedding
                if isinstance(emb, list) and len(emb) > 0 and isinstance(emb[0], list):
                    emb = emb[0]
                valid_labels_and_embs.append((l, emb))

        n_samples = len(valid_labels_and_embs)
        log.info(f"Retrieved {n_samples} embedded failure labels for clustering.")

        if n_samples == 0:
            return {
                "modes_found": 0,
                "clustered_count": 0,
                "noise_count": 0,
                "cluster_size_distribution": {},
                "previews": []
            }

        # 3. Dimensionality Reduction & HDBSCAN
        X = np.array([emb for _, emb in valid_labels_and_embs], dtype=np.float32)

        # Apply PCA to reduce dimensionality to 50 dimensions if features exceed 50
        if X.shape[1] > 50 and X.shape[0] > 50:
            pca = PCA(n_components=50, random_state=42)
            X_reduced = pca.fit_transform(X)
        else:
            X_reduced = X

        # Run clustering
        if n_samples >= min_cluster_size:
            try:
                hdb = HDBSCAN(min_cluster_size=min_cluster_size, allow_single_cluster=True)
                labels_pred = hdb.fit_predict(X_reduced)
            except Exception as e:
                log.warning(f"HDBSCAN failed: {e}. Treating all as noise.")
                labels_pred = np.full(n_samples, -1, dtype=np.int32)
        else:
            labels_pred = np.full(n_samples, -1, dtype=np.int32)

        # Group by predicted clusters (ignoring noise -1)
        clusters_dict = {}
        noise_count = 0

        for i, label_id in enumerate(labels_pred):
            fl, emb = valid_labels_and_embs[i]
            if label_id == -1:
                noise_count += 1
                continue
            if label_id not in clusters_dict:
                clusters_dict[label_id] = []
            clusters_dict[label_id].append((fl, emb))

        # Filter out clusters smaller than min_cluster_size
        valid_clusters = {}
        for c_id, members in clusters_dict.items():
            if len(members) < min_cluster_size:
                noise_count += len(members)
                continue
            valid_clusters[c_id] = members

        log.info(f"Formed {len(valid_clusters)} valid clusters. Noise count: {noise_count}")

        previews = []
        cluster_size_distribution = {}

        if not is_preview:
            # Delete old failure modes for this benchmark to refresh
            db.query(FailureMode).filter(FailureMode.benchmark_slug == benchmark_slug).delete()
            db.commit()

        # Process each valid cluster
        for c_id, members in valid_clusters.items():
            cluster_size = len(members)
            cluster_size_distribution[str(c_id)] = cluster_size

            # 4. Find dominant taxonomy and severity
            tax_counts = {}
            sev_counts = {}
            for fl, _ in members:
                tax = fl.taxonomy_primary or "other"
                sev = fl.severity or "medium"
                tax_counts[tax] = tax_counts.get(tax, 0) + 1
                sev_counts[sev] = sev_counts.get(sev, 0) + 1

            dominant_tax = max(tax_counts, key=tax_counts.get)
            dominant_sev = max(sev_counts, key=sev_counts.get)

            # 5. Find representative failure labels closest to cluster centroid
            cluster_embs = np.array([emb for _, emb in members], dtype=np.float32)
            centroid = np.mean(cluster_embs, axis=0)

            distances = []
            for fl, emb in members:
                dist = float(np.linalg.norm(np.array(emb, dtype=np.float32) - centroid))
                distances.append((fl, dist))

            distances.sort(key=lambda x: x[1])
            closest_labels = [fl for fl, dist in distances[:5]]

            # 6. LLM Naming call
            diagnoses_text_list = []
            for idx, fl in enumerate(closest_labels):
                diagnoses_text_list.append(f"{idx+1}. {fl.diagnosis_text} [taxonomy={fl.taxonomy_primary}, severity={fl.severity}]")

            diagnoses_block = "\n".join(diagnoses_text_list)

            SYSTEM_NAMING_PROMPT = """You are an expert in analyzing and naming failure modes for AI agents.
You must generate concise names and descriptions for clusters of failures.
Respond in JSON only."""

            USER_NAMING_PROMPT = f"""Here are several failure diagnoses that belong to one cluster:

{diagnoses_block}

Based on these, generate:

- name: 3-8 words, concise but specific, suitable as a failure-mode label
- description: 2-4 sentences explaining the pattern, concrete and actionable

Return JSON:
{{
  "name": "...",
  "description": "..."
}}"""

            try:
                parsed, latency = llm_client.chat_json(SYSTEM_NAMING_PROMPT, USER_NAMING_PROMPT)
                validated = FailureModeLLM(**parsed)
                mode_name = validated.name
                mode_desc = validated.description
            except Exception as e:
                log.warning(f"Failed LLM cluster naming for cluster {c_id}: {e}. Using default values.")
                mode_name = f"{dominant_tax} / {dominant_sev} Failure Cluster"
                mode_desc = f"Unsupervised failure mode cluster for category '{dominant_tax}' and severity '{dominant_sev}'."

            previews.append({
                "id": f"c_{c_id}",
                "taxonomy_primary": dominant_tax,
                "severity": dominant_sev,
                "name": mode_name,
                "description": mode_desc,
                "failure_count": cluster_size,
                "member_ids": [fl.id for fl, _ in members]
            })

            if not is_preview:
                # Store FailureMode
                fm_id = str(uuid.uuid4())
                fm = FailureMode(
                    id=fm_id,
                    benchmark_slug=benchmark_slug,
                    name=mode_name,
                    description=mode_desc,
                    taxonomy_primary=dominant_tax,
                    severity=dominant_sev,
                    cluster_algo=cluster_algo,
                    embedding_model=model_name,
                    prompt_version=prompt_version,
                    model_version=llm_client.model,
                    created_at=datetime.utcnow()
                )
                db.add(fm)
                db.flush()

                # Store FailureModeMembers
                for fl, dist in distances:
                    fmm = FailureModeMember(
                        failure_mode_id=fm_id,
                        failure_label_id=fl.id,
                        distance=dist
                    )
                    db.add(fmm)

        if not is_preview:
            db.commit()

        return {
            "modes_found": len(previews),
            "clustered_count": n_samples - noise_count,
            "noise_count": noise_count,
            "cluster_size_distribution": cluster_size_distribution,
            "previews": previews
        }

    except Exception as exc:
        clustering_failures_counter += 1
        log.error(f"Clustering algorithm failure: {exc}")
        db.rollback()
        raise exc

def run_cluster_job(job_id: str, payload: Dict[str, Any]) -> None:
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = "running"
            job.progress = 10.0
            db.commit()

        benchmark_slug = payload.get("benchmark_slug")
        run_ids = payload.get("run_ids")
        single_run_id = payload.get("run_id")

        if not run_ids and single_run_id:
            run_ids = [single_run_id]

        if not benchmark_slug:
            # Fallback: identify from target run_ids
            target_id = None
            if run_ids:
                target_id = run_ids[0]
            elif single_run_id:
                target_id = single_run_id

            if target_id:
                first_run = db.query(Run).filter(Run.id == target_id).first()
                if first_run:
                    benchmark_slug = first_run.benchmark_slug
        
        if not benchmark_slug:
            raise ValueError("benchmark_slug not provided and could not be inferred.")
        embedding_model = payload.get("embedding_model")
        min_cluster_size = payload.get("min_cluster_size", 3)

        if job:
            job.progress = 30.0
            db.commit()

        # Run pipeline
        res = cluster_failure_modes(
            db=db,
            benchmark_slug=benchmark_slug,
            run_ids=run_ids,
            embedding_model=embedding_model,
            min_cluster_size=min_cluster_size,
            is_preview=False
        )

        if job:
            job.status = "completed"
            job.progress = 100.0
            job.result = {
                "cluster_run_id": job_id,
                "timestamp": datetime.utcnow().isoformat(),
                "parameters": {
                    "benchmark_slug": benchmark_slug,
                    "run_ids": run_ids,
                    "embedding_model": embedding_model,
                    "min_cluster_size": min_cluster_size
                },
                **res
            }
            job.finished_at = datetime.utcnow()
            db.commit()
            log.info(f"Clustering job {job_id} finished successfully.")

    except Exception as exc:
        log.error(f"Cluster job {job_id} failed: {exc}")
        if job:
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()
