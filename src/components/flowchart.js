import { fmt, fmtRate, getImageUrl } from '../modules/state.js';

/**
 * Flowchart renderer — SatisfactoryTools-inspired.
 * Left-to-right DAG with building/item icons on nodes,
 * item icons on edges, zoom + pan + drag.
 */

const NODE_W = 220;
const NODE_H = 72;
const RAW_W = 160;
const RAW_H = 48;
const H_GAP = 120;
const V_GAP = 32;
const COLORS = {
    recipeBg: '#c2410c',
    recipeBorder: '#ea580c',
    recipeText: '#fff',
    rawBg: '#1e293b',
    rawBorder: '#475569',
    rawText: '#94a3b8',
    outputBg: '#047857',
    outputBorder: '#10b981',
    outputText: '#fff',
    edge: '#64748b',
    edgeText: '#94a3b8',
    canvasBg: '#0c1220'
};

let nodes = [];
let edges = [];
let dragNode = null;
let dragOffset = { x: 0, y: 0 };
let pan = { x: 60, y: 60 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let zoom = 1;
let imageCache = new Map();

export function renderFlowchart() { return ''; }

export function initFlowchart(result, gameData) {
    const canvas = document.getElementById('flowchart-canvas');
    if (!canvas) return;

    // Reset state
    imageCache = new Map();
    pan = { x: 60, y: 60 };
    zoom = 1;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = canvas.offsetHeight * dpr;
    };
    resize();
    const ctx = canvas.getContext('2d');

    buildGraph(result, gameData);
    layoutGraph();

    // Preload item/building images
    const imageUrls = new Set();
    for (const step of result.steps) {
        const bld = step.buildingId ? gameData.buildings[step.buildingId] : null;
        if (bld?.image) imageUrls.add(getImageUrl(bld.image));
        for (const inp of step.inputs) {
            const item = gameData.items[inp.itemId];
            if (item?.image) imageUrls.add(getImageUrl(item.image));
        }
        for (const out of step.outputs) {
            const item = gameData.items[out.itemId];
            if (item?.image) imageUrls.add(getImageUrl(item.image));
        }
    }
    for (const [itemId] of Object.entries(result.rawResources)) {
        const item = gameData.items[itemId];
        if (item?.image) imageUrls.add(getImageUrl(item.image));
    }

    let loaded = 0;
    const total = imageUrls.size;
    for (const url of imageUrls) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { imageCache.set(url, img); loaded++; if (loaded >= total) draw(ctx, canvas, dpr, gameData); };
        img.onerror = () => { loaded++; if (loaded >= total) draw(ctx, canvas, dpr, gameData); };
        img.src = url;
    }
    if (total === 0) draw(ctx, canvas, dpr, gameData);

    // Mouse events
    canvas.onmousedown = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left - pan.x) / zoom;
        const my = (e.clientY - rect.top - pan.y) / zoom;
        dragNode = null;
        for (const node of nodes) {
            const w = node.type === 'recipe' || node.type === 'output' ? NODE_W : RAW_W;
            const h = node.type === 'recipe' || node.type === 'output' ? NODE_H : RAW_H;
            if (mx >= node.x && mx <= node.x + w && my >= node.y && my <= node.y + h) {
                dragNode = node;
                dragOffset = { x: mx - node.x, y: my - node.y };
                canvas.style.cursor = 'grabbing';
                return;
            }
        }
        isPanning = true;
        panStart = { x: e.clientX - pan.x, y: e.clientY - pan.y };
        canvas.style.cursor = 'grabbing';
    };
    canvas.onmousemove = (e) => {
        const rect = canvas.getBoundingClientRect();
        if (dragNode) {
            const mx = (e.clientX - rect.left - pan.x) / zoom;
            const my = (e.clientY - rect.top - pan.y) / zoom;
            dragNode.x = mx - dragOffset.x;
            dragNode.y = my - dragOffset.y;
            draw(ctx, canvas, dpr, gameData);
        } else if (isPanning) {
            pan.x = e.clientX - panStart.x;
            pan.y = e.clientY - panStart.y;
            draw(ctx, canvas, dpr, gameData);
        }
    };
    canvas.onmouseup = () => { dragNode = null; isPanning = false; canvas.style.cursor = 'grab'; };
    canvas.onmouseleave = () => { dragNode = null; isPanning = false; canvas.style.cursor = 'grab'; };

    // Zoom
    canvas.onwheel = (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.2, Math.min(3, zoom * delta));
        pan.x = mx - (mx - pan.x) * (newZoom / zoom);
        pan.y = my - (my - pan.y) * (newZoom / zoom);
        zoom = newZoom;
        draw(ctx, canvas, dpr, gameData);
    };
}

function buildGraph(result, gameData) {
    nodes = [];
    edges = [];
    const stepNodes = new Map();
    const rawNodes = new Map();

    for (const step of result.steps) {
        const building = step.buildingId ? gameData.buildings[step.buildingId] : null;
        const bldImg = building?.image ? getImageUrl(building.image) : null;
        const node = {
            id: step.recipeId + '__' + step.targetItemId,
            type: 'recipe',
            label1: step.recipeName,
            label2: `${step.machineCount}× ${building?.name || 'Machine'}`,
            label3: `${fmt(step.clockSpeed)}%`,
            buildingImg: bldImg,
            x: 0, y: 0
        };
        nodes.push(node);
        stepNodes.set(node.id, node);
    }

    for (const [itemId, rate] of Object.entries(result.rawResources)) {
        const item = gameData.items[itemId];
        const node = {
            id: 'raw__' + itemId,
            type: 'raw',
            label1: item?.name || itemId,
            label2: fmtRate(rate, itemId, gameData),
            itemImg: item?.image ? getImageUrl(item.image) : null,
            x: 0, y: 0
        };
        nodes.push(node);
        rawNodes.set(itemId, node);
    }

    const targetName = gameData.items[result.targetItemId]?.name || result.targetItemId;
    const targetItem = gameData.items[result.targetItemId];
    const outputNode = {
        id: 'output__' + result.targetItemId,
        type: 'output',
        label1: targetName,
        label2: fmtRate(result.targetRate, result.targetItemId, gameData),
        itemImg: targetItem?.image ? getImageUrl(targetItem.image) : null,
        x: 0, y: 0
    };
    nodes.push(outputNode);

    for (const step of result.steps) {
        const stepNode = stepNodes.get(step.recipeId + '__' + step.targetItemId);
        if (!stepNode) continue;
        for (const inp of step.inputs) {
            const sourceRaw = rawNodes.get(inp.itemId);
            const sourceStep = findStepProducing(inp.itemId, result.steps, stepNodes);
            const source = sourceStep || sourceRaw;
            if (source) {
                const rate = inp.ratePerMachine * step.machineCountRaw;
                const item = gameData.items[inp.itemId];
                edges.push({
                    from: source.id, to: stepNode.id,
                    label: fmtRate(rate, inp.itemId, gameData),
                    itemName: item?.name || inp.itemId,
                    itemImg: item?.image ? getImageUrl(item.image) : null
                });
            }
        }
        if (step.targetItemId === result.targetItemId) {
            edges.push({
                from: stepNode.id, to: outputNode.id,
                label: fmtRate(result.targetRate, result.targetItemId, gameData),
                itemName: targetName,
                itemImg: targetItem?.image ? getImageUrl(targetItem.image) : null
            });
        }
        for (const out of step.outputs) {
            if (out.itemId === result.targetItemId) continue;
            for (const cs of result.steps) {
                if (cs === step) continue;
                if (cs.inputs.find(i => i.itemId === out.itemId)) {
                    const cn = stepNodes.get(cs.recipeId + '__' + cs.targetItemId);
                    if (cn && !edges.find(e => e.from === stepNode.id && e.to === cn.id && e.itemName === (gameData.items[out.itemId]?.name || out.itemId))) {
                        const rate = out.ratePerMachine * step.machineCountRaw;
                        const item = gameData.items[out.itemId];
                        edges.push({
                            from: stepNode.id, to: cn.id,
                            label: fmtRate(rate, out.itemId, gameData),
                            itemName: item?.name || out.itemId,
                            itemImg: item?.image ? getImageUrl(item.image) : null
                        });
                    }
                }
            }
        }
    }
}

function findStepProducing(itemId, steps, stepNodes) {
    for (const step of steps) {
        if (step.outputs.some(o => o.itemId === itemId)) {
            return stepNodes.get(step.recipeId + '__' + step.targetItemId);
        }
    }
    return null;
}

function layoutGraph() {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const incomingEdges = new Map();
    for (const e of edges) {
        if (!incomingEdges.has(e.to)) incomingEdges.set(e.to, []);
        incomingEdges.get(e.to).push(e.from);
    }
    const layers = new Map();
    const visited = new Set();
    function getLayer(id) {
        if (layers.has(id)) return layers.get(id);
        if (visited.has(id)) return 0;
        visited.add(id);
        const incoming = incomingEdges.get(id) || [];
        if (incoming.length === 0) { layers.set(id, 0); return 0; }
        let maxParent = 0;
        for (const parentId of incoming) maxParent = Math.max(maxParent, getLayer(parentId));
        const layer = maxParent + 1;
        layers.set(id, layer);
        return layer;
    }
    for (const node of nodes) getLayer(node.id);

    const layerGroups = {};
    for (const node of nodes) {
        const l = layers.get(node.id) || 0;
        if (!layerGroups[l]) layerGroups[l] = [];
        layerGroups[l].push(node);
    }
    const layerKeys = Object.keys(layerGroups).map(Number).sort((a, b) => a - b);
    for (const l of layerKeys) {
        const group = layerGroups[l];
        const x = l * (NODE_W + H_GAP);
        const totalHeight = group.reduce((sum, n) => {
            return sum + (n.type === 'recipe' || n.type === 'output' ? NODE_H : RAW_H) + V_GAP;
        }, -V_GAP);
        let y = -totalHeight / 2 + 300;
        for (const node of group) {
            const h = node.type === 'recipe' || node.type === 'output' ? NODE_H : RAW_H;
            node.x = x; node.y = y; y += h + V_GAP;
        }
    }
}

function draw(ctx, canvas, dpr, gameData) {
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.canvasBg;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Edges
    for (const edge of edges) {
        const fromNode = nodes.find(n => n.id === edge.from);
        const toNode = nodes.find(n => n.id === edge.to);
        if (!fromNode || !toNode) continue;
        const fromW = fromNode.type === 'recipe' || fromNode.type === 'output' ? NODE_W : RAW_W;
        const fromH = fromNode.type === 'recipe' || fromNode.type === 'output' ? NODE_H : RAW_H;
        const toH = toNode.type === 'recipe' || toNode.type === 'output' ? NODE_H : RAW_H;
        const x1 = fromNode.x + fromW;
        const y1 = fromNode.y + fromH / 2;
        const x2 = toNode.x;
        const y2 = toNode.y + toH / 2;
        const cpx = (x1 + x2) / 2;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(cpx, y1, cpx, y2, x2, y2);
        ctx.strokeStyle = COLORS.edge;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Arrow
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 8, y2 - 4);
        ctx.lineTo(x2 - 8, y2 + 4);
        ctx.closePath();
        ctx.fillStyle = COLORS.edge;
        ctx.fill();

        // Edge label with item icon
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;

        // Draw item icon on edge
        if (edge.itemImg && imageCache.has(edge.itemImg)) {
            const img = imageCache.get(edge.itemImg);
            ctx.drawImage(img, midX - 10, midY - 22, 20, 20);
        }

        ctx.font = '10px Inter, sans-serif';
        ctx.fillStyle = COLORS.edgeText;
        ctx.textAlign = 'center';
        ctx.fillText(edge.label, midX, midY + 10);
    }

    // Nodes
    for (const node of nodes) {
        const isRecipe = node.type === 'recipe';
        const isOutput = node.type === 'output';
        const nw = isRecipe || isOutput ? NODE_W : RAW_W;
        const nh = isRecipe || isOutput ? NODE_H : RAW_H;
        const bg = isOutput ? COLORS.outputBg : (isRecipe ? COLORS.recipeBg : COLORS.rawBg);
        const border = isOutput ? COLORS.outputBorder : (isRecipe ? COLORS.recipeBorder : COLORS.rawBorder);
        const textColor = isOutput ? COLORS.outputText : (isRecipe ? COLORS.recipeText : COLORS.rawText);

        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 2;

        ctx.beginPath();
        roundRect(ctx, node.x, node.y, nw, nh, 8);
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.strokeStyle = border;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.shadowColor = 'transparent';

        // Building/item icon inside node
        const iconUrl = node.buildingImg || node.itemImg;
        if (iconUrl && imageCache.has(iconUrl)) {
            const img = imageCache.get(iconUrl);
            const iconSize = isRecipe ? 28 : 22;
            ctx.drawImage(img, node.x + 8, node.y + (nh - iconSize) / 2, iconSize, iconSize);
        }

        const textX = iconUrl ? node.x + 42 : node.x + nw / 2;
        const align = iconUrl ? 'left' : 'center';
        ctx.fillStyle = textColor;
        ctx.textAlign = align;
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.fillText(truncate(node.label1, 20), textX, node.y + nh / 2 - (node.label3 ? 8 : (node.label2 ? 4 : 2)));

        if (node.label2) {
            ctx.font = '10px Inter, sans-serif';
            ctx.fillStyle = isRecipe ? 'rgba(255,255,255,0.75)' : COLORS.rawText;
            ctx.fillText(truncate(node.label2, 22), textX, node.y + nh / 2 + 6);
        }
        if (node.label3) {
            ctx.font = '9px JetBrains Mono, monospace';
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.fillText(node.label3, textX, node.y + nh / 2 + 18);
        }
    }
    ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
}

function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len - 1) + '…' : str;
}
