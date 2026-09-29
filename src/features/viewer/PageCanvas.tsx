import { useEffect, useRef, useState } from 'react';
import { displaySize, effectiveRotation, type ObjectId, type Page } from '../../core';
import type { PageRenderer } from '../../pdf/renderer-port';

function overlayTransform(rotation: number, w: number, h: number): string {
  switch (rotation) {
    case 90: return `translate(${h}px, 0) rotate(90deg)`;
    case 180: return `translate(${w}px, ${h}px) rotate(180deg)`;
    case 270: return `translate(0, ${w}px) rotate(270deg)`;
    default: return 'none';
  }
}

interface Props {
  page: Page;
  scale: number;
  renderer: PageRenderer;
  selectedObjectId: ObjectId | null;
  onSelectObject: (id: ObjectId | null) => void;
}

/** Página do viewer: canvas do conteúdo original + overlay com os objetos do MODELO (fonte de verdade). */
export function PageCanvas({ page, scale, renderer, selectedObjectId, onSelectObject }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderState, setRenderState] = useState('pending');
  const [reduced, setReduced] = useState(false);
  const [errorText, setErrorText] = useState('');
  const rotation = effectiveRotation(page);
  const size = displaySize(page);
  const originKey = page.origin.kind === 'source' ? `${page.origin.sourceId}:${page.origin.index}` : 'blank';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setRenderState('rendering');
    setErrorText('');
    if (page.origin.kind === 'blank') {
      canvas.width = Math.round(size.w * scale);
      canvas.height = Math.round(size.h * scale);
      canvas.style.width = `${canvas.width}px`;
      canvas.style.height = `${canvas.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      setRenderState('done');
      return;
    }
    const ctrl = new AbortController();
    renderer
      .render({ sourceId: page.origin.sourceId, index: page.origin.index, rotation, scale, canvas, signal: ctrl.signal })
      .then((result) => {
        if (ctrl.signal.aborted || !result) return;
        setReduced(result.reducedResolution);
        setRenderState('done');
      })
      .catch((error: unknown) => {
        if (ctrl.signal.aborted) return;
        console.error('Falha ao renderizar a página', page.id, error);
        setErrorText(error instanceof Error ? error.message : String(error));
        setRenderState('error');
      });
    return () => ctrl.abort();
  }, [originKey, rotation, scale, renderer]);

  const w = page.crop.w * scale;
  const h = page.crop.h * scale;
  return (
    <div className="page-frame" style={{ width: size.w * scale, height: size.h * scale }} onClick={() => onSelectObject(null)}>
      <canvas ref={canvasRef} data-testid="page-canvas" data-render-state={renderState} data-canvas-reduced={String(reduced)} data-page-id={page.id} data-rotation={String(rotation)} />
      {renderState === 'error' ? <div className="render-error" data-testid="render-error">Não foi possível desenhar esta página{errorText ? `: ${errorText}` : ''}</div> : null}
      <div className="overlay" style={{ width: w, height: h, transform: overlayTransform(rotation, w, h) }}>
        {page.objects.map((o) => (
          <div
            key={o.id}
            className={o.id === selectedObjectId ? 'text-object selected' : 'text-object'}
            data-testid="text-object"
            data-object-id={o.id}
            onClick={(e: { stopPropagation: () => void }) => { e.stopPropagation(); onSelectObject(o.id); }}
            style={{ left: o.rect.x * scale, top: o.rect.y * scale, width: o.rect.w * scale, height: o.rect.h * scale, fontSize: o.fontSize * scale, color: `rgb(${Math.round(o.color.r * 255)},${Math.round(o.color.g * 255)},${Math.round(o.color.b * 255)})` }}
          >
            {o.text}
          </div>
        ))}
      </div>
    </div>
  );
}
