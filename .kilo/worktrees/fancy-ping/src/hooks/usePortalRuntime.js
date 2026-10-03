import { useEffect } from 'react';

export function usePortalRuntime(onReady) {
  useEffect(() => {
    onReady?.();
  }, [onReady]);
}