"use client";

import { useEffect, useMemo, useRef, useState } from 'react';

type Tool =
  | 'brush'
  | 'eraser'
  | 'line'
  | 'rectangle'
  | 'ellipse'
  | 'fill'
  | 'eyedropper'
  | 'text'
  | 'select';

interface HistoryEntry {
  imageData: ImageData;
}

function useCanvasSize() {
  const [size, setSize] = useState({ width: 1024, height: 700 });
  useEffect(() => {
    const onResize = () => {
      const maxW = Math.min(window.innerWidth - 32, 1200);
      const maxH = Math.min(window.innerHeight - 160, 800);
      setSize({ width: Math.max(320, maxW), height: Math.max(240, maxH) });
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Page() {
  const { width, height } = useCanvasSize();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<Tool>('brush');
  const [brushColor, setBrushColor] = useState('#000000');
  const [fillColor, setFillColor] = useState('#0000ff');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [brushSize, setBrushSize] = useState(6);
  const [fontSize, setFontSize] = useState(20);
  const [fontFamily, setFontFamily] = useState('Arial');
  const isDrawing = useRef(false);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<{
    x: number; y: number; w: number; h: number; image?: ImageData
  } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [redo, setRedo] = useState<HistoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const [textPos, setTextPos] = useState<{x:number;y:number}|null>(null);

  const ctx = useMemo(() => canvasRef.current?.getContext('2d') ?? null, [canvasRef.current]);
  const overlayCtx = useMemo(() => overlayRef.current?.getContext('2d') ?? null, [overlayRef.current]);

  useEffect(() => {
    if (!ctx || !canvasRef.current) return;
    canvasRef.current.width = width;
    canvasRef.current.height = height;
    const imageData = ctx.createImageData(width, height);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = parseInt(bgColor.slice(1,3),16);
      const g = parseInt(bgColor.slice(3,5),16);
      const b = parseInt(bgColor.slice(5,7),16);
      imageData.data[i] = r;
      imageData.data[i+1] = g;
      imageData.data[i+2] = b;
      imageData.data[i+3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    pushHistory();
  }, [ctx, width, height]);

  useEffect(() => {
    if (!ctx || !canvasRef.current) return;
    const current = ctx.getImageData(0,0,canvasRef.current.width, canvasRef.current.height);
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = current.width;
    tempCanvas.height = current.height;
    const tctx = tempCanvas.getContext('2d')!;
    tctx.putImageData(current,0,0);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0,0,canvasRef.current.width, canvasRef.current.height);
    ctx.drawImage(tempCanvas,0,0);
    pushHistory();
  }, [bgColor]);

  useEffect(() => {
    if (!overlayRef.current) return;
    overlayRef.current.width = width;
    overlayRef.current.height = height;
  }, [overlayRef.current, width, height]);

  function getPos(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return { x: Math.floor(e.clientX - rect.left), y: Math.floor(e.clientY - rect.top) };
  }

  function pushHistory() {
    if (!ctx || !canvasRef.current) return;
    const imageData = ctx.getImageData(0,0,canvasRef.current.width, canvasRef.current.height);
    setHistory((h) => [...h, { imageData }]);
    setRedo([]);
  }

  function undo() {
    if (history.length <= 1 || !ctx || !canvasRef.current) return;
    const newRedo = history[history.length-1];
    const prev = history[history.length-2];
    setRedo((r) => [...r, newRedo]);
    setHistory((h) => h.slice(0, h.length-1));
    ctx.putImageData(prev.imageData, 0, 0);
  }

  function redoAction() {
    if (!ctx || !canvasRef.current || redo.length === 0) return;
    const entry = redo[redo.length-1];
    setRedo((r) => r.slice(0, r.length-1));
    setHistory((h) => [...h, entry]);
    ctx.putImageData(entry.imageData, 0, 0);
  }

  function onPointerDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!ctx) return;
    isDrawing.current = true;
    const p = getPos(e);
    startPos.current = p;

    if (tool === 'text') {
      setTextPos(p);
      return;
    }

    if (tool === 'select') {
      setSelection({ x: p.x, y: p.y, w: 0, h: 0 });
      return;
    }

    if (tool === 'fill') {
      floodFill(p.x, p.y);
      pushHistory();
      isDrawing.current = false;
      return;
    }

    if (tool === 'eyedropper') {
      const c = ctx.getImageData(p.x, p.y, 1, 1).data;
      const hex = `#${[c[0], c[1], c[2]].map(v => v.toString(16).padStart(2,'0')).join('')}`;
      setBrushColor(hex);
      isDrawing.current = false;
      return;
    }

    if (tool === 'brush' || tool === 'eraser') {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = brushSize;
      ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : brushColor;
      ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.stroke();
    }
  }

  function onPointerMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!ctx) return;
    const p = getPos(e);
    if (!isDrawing.current) {
      if (tool === 'text' && textPos && overlayCtx) {
        drawTextPreview(overlayCtx, p);
      }
      return;
    }

    if (tool === 'brush' || tool === 'eraser') {
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      return;
    }

    if (overlayCtx && (tool === 'line' || tool === 'rectangle' || tool === 'ellipse' || tool === 'select')) {
      overlayCtx.clearRect(0,0,width,height);
      overlayCtx.strokeStyle = '#3b82f6';
      overlayCtx.setLineDash([6, 6]);
      overlayCtx.lineWidth = 1;
      const s = startPos.current!;
      const w = p.x - s.x;
      const h = p.y - s.y;
      if (tool === 'line') {
        overlayCtx.beginPath();
        overlayCtx.moveTo(s.x, s.y);
        overlayCtx.lineTo(p.x, p.y);
        overlayCtx.stroke();
      } else if (tool === 'rectangle' || tool === 'select') {
        overlayCtx.strokeRect(s.x, s.y, w, h);
      } else if (tool === 'ellipse') {
        overlayCtx.beginPath();
        overlayCtx.ellipse(s.x + w/2, s.y + h/2, Math.abs(w/2), Math.abs(h/2), 0, 0, Math.PI*2);
        overlayCtx.stroke();
      }
    }
  }

  function onPointerUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!ctx) return;
    const p = getPos(e);
    if (!isDrawing.current) return;
    isDrawing.current = false;

    if (tool === 'brush' || tool === 'eraser') {
      ctx.closePath();
      ctx.globalCompositeOperation = 'source-over';
      pushHistory();
      return;
    }

    const s = startPos.current!;
    if (overlayCtx) overlayCtx.clearRect(0,0,width,height);

    if (tool === 'line') {
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineWidth = brushSize;
      ctx.strokeStyle = brushColor;
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      pushHistory();
    } else if (tool === 'rectangle') {
      ctx.lineWidth = 1;
      ctx.strokeStyle = brushColor;
      ctx.fillStyle = brushColor + '00';
      ctx.strokeRect(s.x, s.y, p.x - s.x, p.y - s.y);
      pushHistory();
    } else if (tool === 'ellipse') {
      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.strokeStyle = brushColor;
      ctx.ellipse(s.x + (p.x - s.x)/2, s.y + (p.y - s.y)/2, Math.abs((p.x - s.x)/2), Math.abs((p.y - s.y)/2), 0, 0, Math.PI*2);
      ctx.stroke();
      pushHistory();
    } else if (tool === 'select') {
      const x = Math.min(s.x, p.x);
      const y = Math.min(s.y, p.y);
      const w = Math.abs(p.x - s.x);
      const h = Math.abs(p.y - s.y);
      if (w > 0 && h > 0) {
        const img = ctx.getImageData(x, y, w, h);
        setSelection({ x, y, w, h, image: img });
      }
    }
  }

  function floodFill(x: number, y: number) {
    if (!ctx || !canvasRef.current) return;
    const { width: w, height: h } = canvasRef.current;
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;

    const target = (y*w + x) * 4;
    const tr = data[target];
    const tg = data[target+1];
    const tb = data[target+2];

    const nr = parseInt(fillColor.slice(1,3),16);
    const ng = parseInt(fillColor.slice(3,5),16);
    const nb = parseInt(fillColor.slice(5,7),16);

    if (tr === nr && tg === ng && tb === nb) return;

    const stack: Array<[number, number]> = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
      const idx = (cy*w + cx) * 4;
      if (data[idx] === tr && data[idx+1] === tg && data[idx+2] === tb) {
        data[idx] = nr; data[idx+1] = ng; data[idx+2] = nb; data[idx+3] = 255;
        stack.push([cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]);
      }
    }

    ctx.putImageData(img, 0, 0);
  }

  function pasteSelectionAt(x: number, y: number) {
    if (!ctx || !selection || !selection.image) return;
    const temp = document.createElement('canvas');
    temp.width = selection.w;
    temp.height = selection.h;
    const tctx = temp.getContext('2d')!;
    tctx.putImageData(selection.image, 0, 0);
    ctx.drawImage(temp, x, y);
  }

  function drawTextPreview(o: CanvasRenderingContext2D, p: {x:number;y:number}) {
    o.clearRect(0,0,width,height);
    const s = textPos!;
    o.setLineDash([6,6]);
    o.strokeStyle = '#3b82f6';
    o.strokeRect(s.x, s.y - fontSize, Math.abs(p.x - s.x), fontSize + 8);
  }

  function confirmText(text: string) {
    if (!ctx || !textPos) return;
    ctx.save();
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.fillStyle = brushColor;
    ctx.textBaseline = 'top';
    ctx.fillText(text, textPos.x, textPos.y);
    ctx.restore();
    setTextPos(null);
    if (overlayCtx) overlayCtx.clearRect(0,0,width,height);
    pushHistory();
  }

  function clearCanvas() {
    if (!ctx || !canvasRef.current) return;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0,0,canvasRef.current.width, canvasRef.current.height);
    pushHistory();
  }

  async function importImageFromFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !canvasRef.current || !ctx) return;
    const img = await fileToImage(file);
    const scale = Math.min(canvasRef.current.width / img.width, canvasRef.current.height / img.height, 1);
    const w = Math.floor(img.width * scale);
    const h = Math.floor(img.height * scale);
    const x = Math.floor((canvasRef.current.width - w) / 2);
    const y = Math.floor((canvasRef.current.height - h) / 2);
    ctx.drawImage(img, x, y, w, h);
    pushHistory();
    e.target.value = '';
  }

  function copySelection() {
    if (!selection) return;
    setSelection({ ...selection });
  }

  function cutSelection() {
    if (!selection || !ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(selection.x, selection.y, selection.w, selection.h);
    pushHistory();
  }

  function deleteSelection() {
    if (!selection || !ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(selection.x, selection.y, selection.w, selection.h);
    setSelection(null);
    pushHistory();
  }

  function pasteSelection() {
    if (!selection) return;
    pasteSelectionAt(selection.x + 10, selection.y + 10);
    pushHistory();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redoAction(); }
      if (e.key === 'Escape') { setSelection(null); setTextPos(null); if (overlayCtx) overlayCtx.clearRect(0,0,width,height); }
      if (e.ctrlKey && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'x') { e.preventDefault(); cutSelection(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteSelection(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, redo, selection, textPos, brushColor, fontSize, fontFamily]);

  return (
    <div className="container">
      <div className="toolbar">
        <div className="group">
          <button className={tool==='brush'? 'active':''} onClick={() => setTool('brush')}>Brush</button>
          <button className={tool==='eraser'? 'active':''} onClick={() => setTool('eraser')}>Eraser</button>
          <button className={tool==='line'? 'active':''} onClick={() => setTool('line')}>Line</button>
          <button className={tool==='rectangle'? 'active':''} onClick={() => setTool('rectangle')}>Rectangle</button>
          <button className={tool==='ellipse'? 'active':''} onClick={() => setTool('ellipse')}>Ellipse</button>
          <button className={tool==='fill'? 'active':''} onClick={() => setTool('fill')}>Fill</button>
          <button className={tool==='eyedropper'? 'active':''} onClick={() => setTool('eyedropper')}>Eyedropper</button>
          <button className={tool==='text'? 'active':''} onClick={() => setTool('text')}>Text</button>
          <button className={tool==='select'? 'active':''} onClick={() => setTool('select')}>Select</button>
        </div>
        <div className="group">
          <label>Line size <input type="range" min={1} max={64} value={brushSize} onChange={(e)=>setBrushSize(Number(e.target.value))} /></label>
          <label>Font size <input type="number" min={8} max={128} value={fontSize} onChange={(e)=>setFontSize(Number(e.target.value)||12)} style={{ width: 70 }} /></label>
          <select value={fontFamily} onChange={(e)=>setFontFamily(e.target.value)}>
            <option>Arial</option>
            <option>Courier New</option>
            <option>Georgia</option>
            <option>Times New Roman</option>
            <option>Verdana</option>
            <option>Monospace</option>
          </select>
        </div>
        <div className="group">
          <label>Color <input type="color" value={brushColor} onChange={(e)=>setBrushColor(e.target.value)} /></label>
          <label>Fill <input type="color" value={fillColor} onChange={(e)=>setFillColor(e.target.value)} /></label>
          <label>Background <input type="color" value={bgColor} onChange={(e)=>setBgColor(e.target.value)} /></label>
        </div>
        <div className="group">
          <button onClick={undo}>Undo</button>
          <button onClick={redoAction}>Redo</button>
          <button onClick={clearCanvas}>Clear</button>
        </div>
        <div className="group">
          <input ref={inputRef} type="file" accept="image/*" onChange={importImageFromFile} />
          <button onClick={() => { if (canvasRef.current) downloadCanvas(canvasRef.current, 'drawing.png'); }}>Export PNG</button>
        </div>
      </div>

      <div className="canvasWrapper" style={{ width, height, margin: '0 auto' }}>
        {textPos && (
          <input
            ref={textInputRef}
            className="textInput"
            style={{ left: textPos.x, top: textPos.y, fontSize, fontFamily }}
            placeholder="Type and press Enter"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                confirmText((e.target as HTMLInputElement).value);
                (e.target as HTMLInputElement).value = '';
              }
            }}
          />
        )}
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          style={{ position: 'absolute', left: 0, top: 0 }}
        />
        <canvas
          ref={overlayRef}
          width={width}
          height={height}
          style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
        />
      </div>
    </div>
  );
}
