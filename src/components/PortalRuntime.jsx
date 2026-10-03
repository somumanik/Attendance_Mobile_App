import { useEffect } from 'react';

export default function PortalRuntime() {
  useEffect(() => {
    document.body.dataset.portalRuntime = 'react';
    return () => delete document.body.dataset.portalRuntime;
  }, []);

  return null;
}