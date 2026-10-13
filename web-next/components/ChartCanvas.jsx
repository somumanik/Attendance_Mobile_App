'use client';

// web-next/components/ChartCanvas.jsx — thin Chart.js wrapper (client-only).
// chart.js ko sirf browser me load karte hain (SSR me module-level import avoid).

import { useEffect, useRef } from 'react';

let ChartPromise = null;
async function loadChart() {
  if (!ChartPromise) {
    ChartPromise = import('chart.js/auto').then((mod) => {
      const Chart = mod.default || mod.Chart;
      Chart.defaults.color = '#cbd5e1';
      Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
      Chart.defaults.font.family = "'Plus Jakarta Sans', 'Segoe UI', sans-serif";
      Chart.defaults.font.size = 11;
      return Chart;
    });
  }
  return ChartPromise;
}

export default function ChartCanvas({ type, data, options, height = 260 }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  const dataKey = JSON.stringify(data || {});
  const optionsKey = JSON.stringify(options || {});

  useEffect(() => {
    let cancelled = false;
    let chart = null;
    (async () => {
      const Chart = await loadChart();
      if (cancelled || !canvasRef.current) return;
      chart = new Chart(canvasRef.current, {
        type,
        data,
        options: { responsive: true, maintainAspectRatio: false, ...options },
      });
      chartRef.current = chart;
    })();
    return () => {
      cancelled = true;
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, dataKey, optionsKey]);

  return (
    <div style={{ position: 'relative', height }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

