import { useEffect, useRef, useState } from 'react';
import { displaySize, effectiveRotation, type Page } from '../../core';
import type { PageRenderer } from '../../pdf/renderer-port';

const THUMB_WIDTH = 120;

/** Miniatura renderizada sob demanda: só quando entra na área visível da barra lateral. */
export function Thumbnail({ page, index, selected, renderer, onSelect }: { page: Page; index: number; selected: boolean; renderer: PageRenderer; onSelect: () => void }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(false);
  const rotation = effectiveRotation(page);
  const size = displaySize(page);
  const scale = THUMB_WIDTH / size.w;
  const originKey = page.origin.kind === 'source' ? `${page.origin.sourceId}:${page.origin.index}` : 'blank';

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) setVisible(true); });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!visible || !canvas) return;
    if (page.origin.kind === 'blank') {
      canvas.width = THUMB_WIDTH; canvas.height = Math.round(size.h * scale);
      const ctx = canvas.getContext('2d');
      if (ctx) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      return;
    }
    const ctrl = new AbortController();
    renderer.render({ sourceId: page.origin.sourceId, index: page.origin.index, rotation, scale, canvas, signal: ctrl.signal }).catch((error: unknown) => { if (!ctrl.signal.aborted) console.error('Falha ao renderizar miniatura', page.id, error); });
    return () => ctrl.abort();
  }, [visible, originKey, rotation, scale, renderer]);

  return (
    <button className={selected ? 'thumb selected' : 'thumb'} data-testid="thumb" data-page-id={page.id} data-rotation={String(rotation)} data-index={String(index)} onClick={onSelect}>
      <div ref={boxRef} style={{ width: THUMB_WIDTH, height: Math.round(size.h * scale) }}>
        <canvas ref={canvasRef} />
      </div>
      <span className="num">{index + 1}</span>
    </button>
  );
}
