import { RunTask } from './types';

interface CleanItem {
  id: string | number; // run_task_id
  text: string; // diagnosis text + slug
  taxonomy: string;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'from', 'up', 'down', 'in', 'out',
  'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
  'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can',
  'will', 'just', 'don', 'should', 'now', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours',
  'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs',
  'themselves', 'agent', 'failed', 'task', 'due', 'error', 'encountered', 'failed', 'succeeded',
  'successfully', 'run', 'running'
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .split(/[\s_]+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word));
}

function calculateJaccardSimilarity(tokens1: string[], tokens2: string[]): number {
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  
  if (set1.size === 0 && set2.size === 0) return 0;
  
  let intersectionSize = 0;
  for (const item of set1) {
    if (set2.has(item)) {
      intersectionSize++;
    }
  }
  
  const unionSize = set1.size + set2.size - intersectionSize;
  return intersectionSize / unionSize;
}

/**
 * Cluster failures locally using Jaccard Similarity and single-linkage grouping
 */
export function clusterFailuresLocally(
  failedTasks: Array<RunTask & { diagnosis_text: string; taxonomy_label: string }>
): Array<{
  title: string;
  description: string;
  taxonomy_label: string;
  memberIds: (string | number)[];
}> {
  if (failedTasks.length === 0) return [];

  const items: CleanItem[] = failedTasks.map(t => ({
    id: t.id!,
    text: `${t.diagnosis_text} ${t.slug} ${t.category}`,
    taxonomy: t.taxonomy_label || 'TOOL_MISUSE'
  }));

  const tokenizedItems = items.map(item => ({
    id: item.id,
    tokens: tokenize(item.text),
    taxonomy: item.taxonomy,
    rawText: item.text,
    diagnosis: failedTasks.find(t => t.id === item.id)!.diagnosis_text
  }));

  const SIMID_THRESHOLD = 0.15; // Minimum similarity to group together
  const clusters: typeof tokenizedItems[] = [];

  for (const item of tokenizedItems) {
    let bestClusterIdx = -1;
    let maxSim = -1;

    for (let i = 0; i < clusters.length; i++) {
      // Compare item to the cluster centroid (all tokens merged or average similarity)
      let sumSim = 0;
      for (const member of clusters[i]) {
        sumSim += calculateJaccardSimilarity(item.tokens, member.tokens);
      }
      const avgSim = sumSim / clusters[i].length;

      if (avgSim > maxSim && avgSim >= SIMID_THRESHOLD) {
        maxSim = avgSim;
        bestClusterIdx = i;
      }
    }

    if (bestClusterIdx !== -1) {
      clusters[bestClusterIdx].push(item);
    } else {
      clusters.push([item]);
    }
  }

  // Generate titles, descriptions, and final structure for clusters
  return clusters.map(cluster => {
    // 1. Find most representative taxonomy
    const taxonomyCounts: Record<string, number> = {};
    cluster.forEach(m => {
      taxonomyCounts[m.taxonomy] = (taxonomyCounts[m.taxonomy] || 0) + 1;
    });
    let bestTaxonomy = 'TOOL_MISUSE';
    let maxTaxCount = 0;
    for (const [tax, count] of Object.entries(taxonomyCounts)) {
      if (count > maxTaxCount) {
        maxTaxCount = count;
        bestTaxonomy = tax;
      }
    }

    // 2. Identify top keywords for naming
    const keywordCounts: Record<string, number> = {};
    cluster.forEach(m => {
      m.tokens.forEach(t => {
        keywordCounts[t] = (keywordCounts[t] || 0) + 1;
      });
    });

    const sortedKeywords = Object.entries(keywordCounts)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0])
      .slice(0, 3);

    // Formulate title
    let title = '';
    const key1 = sortedKeywords[0] ? sortedKeywords[0].toUpperCase() : '';
    const key2 = sortedKeywords[1] ? ` & ${sortedKeywords[1]}` : '';
    
    if (bestTaxonomy === 'CODE_BUG') {
      title = `Syntax & Code Exceptions (${key1}${key2})`;
    } else if (bestTaxonomy === 'GAP') {
      title = `Capability Gap: Missing ${key1}${key2}`;
    } else if (bestTaxonomy === 'AMBIGUITY') {
      title = `Ambiguity & Underspecification (${key1})`;
    } else if (bestTaxonomy === 'UPSTREAM') {
      title = `Upstream network & server issues (${key1})`;
    } else if (bestTaxonomy === 'SAFETY_VIOLATION') {
      title = `Blocked Safety or Permission Lock (${key1})`;
    } else {
      title = `Tool Execution Error: ${key1}${key2}`;
    }

    // Formulate description
    const diagnosisExamples = cluster.slice(0, 2).map(m => m.diagnosis).join(' Also, ');
    const description = `This failure mode groups issues classified under ${bestTaxonomy} characterized by terms like ${sortedKeywords.join(', ')}. Details: ${diagnosisExamples}`;

    return {
      title,
      description,
      taxonomy_label: bestTaxonomy,
      memberIds: cluster.map(m => m.id)
    };
  });
}
