'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Loader2 } from 'lucide-react';

export default function DeleteRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete the run "${runId}" and all of its associated task logs?`)) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/runs?run_id=${encodeURIComponent(runId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        router.refresh();
      } else {
        alert('Failed to delete run.');
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred while deleting the run.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="p-2 text-gray-400 hover:text-rose-400 rounded hover:bg-white/5 transition-colors disabled:opacity-50"
      title="Delete run logs"
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
    </button>
  );
}
