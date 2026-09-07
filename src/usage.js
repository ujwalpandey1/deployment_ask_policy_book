// Sum every provider call, including query embeddings, retries and failures.
// Unknown spend is never converted into zero. Indexing is metered separately.
export const emptyUsage = () => ({ input_tokens: 0, output_tokens: 0, cost_usd: 0, calls: 0, model: null });

export function addUsage(a, b) {
  const sum = key => a[key] === null || b[key] === null ? null : (a[key] || 0) + (b[key] || 0);
  const result = { input_tokens: sum('input_tokens'), output_tokens: sum('output_tokens'), cost_usd: sum('cost_usd'), calls: sum('calls'), model: b.model || a.model };
  if (a.embeddings || b.embeddings) result.embeddings = addUsage(a.embeddings || emptyUsage(), b.embeddings || emptyUsage());
  return result;
}
