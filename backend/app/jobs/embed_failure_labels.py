from sqlalchemy.orm import Session
from app.core.logging import get_logger
from app.domain.models import FailureLabel, FailureLabelEmbedding, Run
from app.core.llm_client import llm_client

log = get_logger(__name__)

def embed_failure_labels(db: Session, benchmark_slug: str, run_ids: list[str] | None = None, embedding_model: str | None = None) -> int:
    model_name = embedding_model or llm_client.model

    # 1. Select all runs for the benchmark
    run_query = db.query(Run).filter(Run.benchmark_slug == benchmark_slug)
    if run_ids:
        run_query = run_query.filter(Run.id.in_(run_ids))
    runs = run_query.all()
    target_run_ids = [r.id for r in runs]

    if not target_run_ids:
        log.info(f"No runs found for benchmark_slug {benchmark_slug}")
        return 0

    # 2. Select failure labels that DO NOT have an embedding for the current model
    labels_to_embed = (
        db.query(FailureLabel)
        .filter(FailureLabel.run_id.in_(target_run_ids))
        .outerjoin(
            FailureLabelEmbedding,
            (FailureLabel.id == FailureLabelEmbedding.failure_label_id) & (FailureLabelEmbedding.model == model_name)
        )
        .filter(FailureLabelEmbedding.failure_label_id == None)
        .all()
    )

    if not labels_to_embed:
        log.info("All failure labels already have embeddings.")
        return 0

    log.info(f"Found {len(labels_to_embed)} failure labels to embed.")

    # Construct texts to embed
    texts_and_ids = []
    for fl in labels_to_embed:
        tax = fl.taxonomy_primary or "other"
        sev = fl.severity or "medium"
        text = f"[taxonomy={tax}][severity={sev}] {fl.diagnosis_text}"
        texts_and_ids.append((fl.id, text))

    # 3. Batch process (64 at a time)
    batch_size = 64
    count = 0
    for i in range(0, len(texts_and_ids), batch_size):
        batch = texts_and_ids[i:i+batch_size]
        batch_ids = [item[0] for item in batch]
        batch_texts = [item[1] for item in batch]

        try:
            embeddings = llm_client.get_embeddings(batch_texts)
        except Exception as e:
            log.warning(f"Failed to generate embeddings via LLM client: {e}. Falling back to taxonomy-based mock embeddings.")
            embeddings = []
            for text in batch_texts:
                tax = "OTHER"
                for t in ['GAP', 'AMBIGUITY', 'TOOL_MISUSE', 'CODE_BUG', 'UPSTREAM', 'SAFETY', 'OTHER']:
                    if f"taxonomy={t}" in text.upper():
                        tax = t
                        break
                vec = [0.0] * 384
                taxonomies = ['GAP', 'AMBIGUITY', 'TOOL_MISUSE', 'CODE_BUG', 'UPSTREAM', 'SAFETY', 'OTHER']
                if tax in taxonomies:
                    idx = taxonomies.index(tax)
                    vec[idx] = 1.0
                import hashlib
                h = int(hashlib.md5(text.encode('utf-8')).hexdigest(), 16)
                for j in range(10):
                    vec[8 + j] = ((h >> (j * 4)) & 0xF) / 150.0
                embeddings.append(vec)

        try:
            for label_id, emb in zip(batch_ids, embeddings):
                existing = db.query(FailureLabelEmbedding).filter(
                    FailureLabelEmbedding.failure_label_id == label_id,
                    FailureLabelEmbedding.model == model_name
                ).first()
                if existing:
                    existing.embedding = emb
                else:
                    new_emb = FailureLabelEmbedding(
                        failure_label_id=label_id,
                        embedding=emb,
                        model=model_name
                    )
                    db.add(new_emb)
                count += 1
            db.commit()
        except Exception as e:
            log.error(f"Failed to save embeddings batch: {e}")
            db.rollback()
            raise e

    return count
