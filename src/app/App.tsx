import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  DocumentSession, ExportError, OpenError, OperationError, assertFileSizeAllowed, exportDocument, getOrderedPages, isWinAnsiText,
  openDocument, sourceLimitations, type ObjectId, type PageId,
} from '../core';
import { PageCanvas } from '../features/viewer/PageCanvas';
import { Thumbnail } from '../features/viewer/Thumbnail';
import type { Services } from './wiring';

type Status = { kind: 'info' | 'ok' | 'error'; text: string };

function download(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function App({ services }: { services: Services }) {
  const [session, setSession] = useState<DocumentSession | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'info', text: 'Abra um PDF para começar.' });
  const [warnings, setWarnings] = useState<string[]>([]);

  /**
   * Abre um arquivo. Consistência: a sessão anterior só é substituída (e seus bytes liberados) DEPOIS que o novo
   * documento foi aberto com sucesso; qualquer falha deixa a sessão atual exatamente como estava.
   */
  const openFile = async (file: File): Promise<void> => {
    try {
      assertFileSizeAllowed(file.size, file.name, services.limits); // antes de ler o arquivo para a memória
      const bytes = new Uint8Array(await file.arrayBuffer());
      const state = await openDocument({ name: file.name, bytes }, services);
      const previous = session;
      setSession(new DocumentSession(state));
      const notes = sourceLimitations(state).map((l) => l.message);
      setWarnings(notes);
      setStatus({ kind: 'ok', text: `"${file.name}" aberto: ${state.pageOrder.length} página(s).` });
      if (previous) {
        for (const id of Object.keys(previous.getState().sources)) {
          await services.renderer.release(id as never);
          await services.sources.delete(id as never);
        }
      }
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof OpenError ? e.message : `Erro ao abrir: ${messageOf(e)}` });
    }
  };

  return (
    <div className="app">
      {session ? (
        <Workspace key={Object.keys(session.getState().sources).join()} session={session} services={services} onStatus={setStatus} onOpen={openFile} warnings={warnings} />
      ) : (
        <>
          <div className="toolbar">
            <span className="title">Simply PDF</span>
            <OpenButton onOpen={openFile} />
          </div>
          <div className="empty">Nenhum documento aberto</div>
        </>
      )}
      <div className={`status ${status.kind === 'info' ? '' : status.kind}`} data-testid="status" role="status">
        {status.text}
      </div>
    </div>
  );
}

function OpenButton({ onOpen }: { onOpen: (file: File) => void }) {
  return (
    <label className="filebtn">
      Abrir PDF…
      <input
        type="file"
        accept="application/pdf,.pdf"
        data-testid="open-input"
        onChange={(e: { target: { files: FileList | null; value: string } }) => {
          const file = e.target.files?.[0];
          if (file) onOpen(file);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function Workspace({ session, services, onStatus, onOpen, warnings }: { session: DocumentSession; services: Services; onStatus: (s: Status) => void; onOpen: (f: File) => void; warnings: string[] }) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const state = snap.state;
  const pages = getOrderedPages(state);
  const [selectedId, setSelectedId] = useState<PageId | null>(pages[0]?.id ?? null);
  const [objectId, setObjectId] = useState<ObjectId | null>(null);
  const [scale, setScale] = useState(1);
  const [draft, setDraft] = useState('Olá, Simply PDF');
  const [busy, setBusy] = useState(false);
  const selected = pages.find((p) => p.id === selectedId) ?? pages[0] ?? null;
  const selectedIndex = selected ? pages.findIndex((p) => p.id === selected.id) : -1;
  // A seleção de objeto só vale enquanto o objeto existe na página selecionada (undo/redo podem removê-lo).
  const selectedObject = selected?.objects.find((o) => o.id === objectId) ?? null;
  const validDraft = draft.trim() !== '' && isWinAnsiText(draft);

  const run = (fn: () => void): void => {
    try { fn(); } catch (e) { onStatus({ kind: 'error', text: e instanceof OperationError ? e.message : messageOf(e) }); }
  };
  const selectPage = (id: PageId): void => { setSelectedId(id); setObjectId(null); };
  const selectObject = (id: ObjectId | null): void => {
    setObjectId(id);
    const o = selected?.objects.find((x) => x.id === id);
    if (o) setDraft(o.text);
  };
  const deletePage = (): void => run(() => {
    if (!selected) return;
    const next = pages[selectedIndex + 1] ?? pages[selectedIndex - 1] ?? null;
    session.execute({ type: 'page/delete', pageIds: [selected.id] });
    setSelectedId(next ? next.id : null);
    setObjectId(null);
  });
  const rotatePage = (): void => run(() => selected && session.execute({ type: 'page/rotate', pageIds: [selected.id], delta: 90 }));
  const addText = (): void => run(() => {
    if (!selected) return;
    const id = services.ids.object();
    session.execute({ type: 'object/add', pageId: selected.id, object: { id, kind: 'text', rect: { x: 72, y: 72, w: 300, h: 60 }, text: draft, fontSize: 18, color: { r: 0.75, g: 0, b: 0 } } });
    setObjectId(id);
  });
  const editText = (): void => run(() => {
    if (!selected || !selectedObject) return;
    session.execute({ type: 'object/update', pageId: selected.id, objectId: selectedObject.id, patch: { text: draft } });
  });
  const removeText = (): void => run(() => {
    if (!selected || !selectedObject) return;
    session.execute({ type: 'object/remove', pageId: selected.id, objectId: selectedObject.id });
    setObjectId(null);
  });
  const undo = (): void => { session.undo(); };
  const redo = (): void => { session.redo(); };

  const exportPdf = async (): Promise<void> => {
    setBusy(true);
    try {
      const { bytes, warnings: exportWarnings } = await exportDocument(state, services);
      download(bytes, state.name.replace(/\.pdf$/i, '') + '-editado.pdf');
      session.markSaved();
      onStatus({ kind: 'ok', text: `Exportado e verificado (${pages.length} página(s), ${bytes.length} bytes).${exportWarnings.length ? ` ${exportWarnings.length} aviso(s): ${exportWarnings.map((w) => w.message).join('; ')}` : ''}` });
    } catch (e) {
      onStatus({ kind: 'error', text: e instanceof ExportError ? e.message : `Erro ao exportar: ${messageOf(e)}` });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); session.undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); session.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  return (
    <>
      <div className="toolbar">
        <span className="title">Simply PDF</span>
        <span className="doc" data-testid="doc-name">{state.name}{snap.isDirty ? ' •' : ''}</span>
        <OpenButton onOpen={onOpen} />
        <span className="sep" />
        <button data-testid="btn-undo" disabled={!snap.canUndo} onClick={undo} title="Desfazer (Ctrl+Z)">Desfazer</button>
        <button data-testid="btn-redo" disabled={!snap.canRedo} onClick={redo} title="Refazer (Ctrl+Y / Ctrl+Shift+Z)">Refazer</button>
        <span className="sep" />
        <button data-testid="btn-rotate" disabled={!selected} onClick={rotatePage}>Girar 90°</button>
        <button data-testid="btn-delete" disabled={!selected || pages.length <= 1} onClick={deletePage}>Excluir página</button>
        <span className="sep" />
        <input
          type="text"
          data-testid="input-text"
          value={draft}
          onChange={(e: { target: { value: string } }) => setDraft(e.target.value)}
          onKeyDown={(e: { key: string }) => { if (e.key === 'Enter' && validDraft) { if (selectedObject) editText(); else addText(); } }}
          aria-label="Texto"
          title="Selecione uma caixa de texto na página para editá-la"
        />
        <button data-testid="btn-add-text" disabled={!selected || !validDraft} onClick={addText} title={draft && !isWinAnsiText(draft) ? 'Caracteres fora do conjunto WinAnsi' : 'Adicionar uma nova caixa de texto'}>Adicionar texto</button>
        <button data-testid="btn-edit-text" disabled={!selectedObject || !validDraft || draft === selectedObject.text} onClick={editText} title="Aplicar o texto acima à caixa selecionada">Editar texto selecionado</button>
        <button data-testid="btn-remove-text" disabled={!selectedObject} onClick={removeText}>Remover texto</button>
        <span className="sep" />
        <button onClick={() => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)))} aria-label="Reduzir zoom">−</button>
        <span data-testid="zoom">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(3, +(s + 0.25).toFixed(2)))} aria-label="Aumentar zoom">+</button>
        <span className="sep" />
        <button className="primary" data-testid="btn-export" disabled={busy} onClick={exportPdf}>Exportar PDF</button>
      </div>
      {warnings.length > 0 ? <div className="warnings" data-testid="open-warnings">{warnings.join(' · ')}</div> : null}
      <div className="workspace">
        <div className="sidebar" data-testid="sidebar">
          {pages.map((p, i) => (
            <Thumbnail key={p.id} page={p} index={i} selected={selected?.id === p.id} renderer={services.renderer} onSelect={() => selectPage(p.id)} />
          ))}
        </div>
        <div className="stage">
          {selected ? <PageCanvas key={selected.id} page={selected} scale={scale} renderer={services.renderer} selectedObjectId={selectedObject?.id ?? null} onSelectObject={selectObject} /> : <div className="empty">Documento sem páginas</div>}
        </div>
      </div>
      <span hidden data-testid="page-count">{pages.length}</span>
    </>
  );
}
