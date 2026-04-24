import { useEffect, useRef, useState } from "react";

export default function PerformanceOverlay() {
  const [fps, setFps] = useState(0);
  const [memoryMB, setMemoryMB] = useState(0);
  const [renderTime, setRenderTime] = useState(0);
  const frameCount = useRef(0);
  const lastFPSTime = useRef(performance.now());

  useEffect(() => {
    let running = true;

    const measureFPS = () => {
      frameCount.current++;
      const now = performance.now();
      const elapsed = now - lastFPSTime.current;

      if (elapsed >= 500) {
        setFps(Math.round((frameCount.current / elapsed) * 1000));
        frameCount.current = 0;
        lastFPSTime.current = now;

        // Memory
        if ("memory" in performance) {
          const mem = (performance as any).memory;
          setMemoryMB(Math.round(mem.usedJSHeapSize / 1024 / 1024));
        }
      }

      if (running) requestAnimationFrame(measureFPS);
    };

    requestAnimationFrame(measureFPS);
    return () => {
      running = false;
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        right: 8,
        background: "rgba(0,0,0,0.75)",
        color: "#0f0",
        padding: "8px 12px",
        borderRadius: 6,
        fontFamily: "monospace",
        fontSize: 12,
        zIndex: 100,
        lineHeight: 1.6,
      }}
    >
      <div>FPS: <strong>{fps}</strong></div>
      <div>Memory: <strong>{memoryMB} MB</strong></div>
      {renderTime > 0 && (
        <div>Render: <strong>{renderTime.toFixed(1)} ms</strong></div>
      )}
    </div>
  );
}
