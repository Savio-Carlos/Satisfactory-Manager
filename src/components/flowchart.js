import { fmt, fmtRate, getImageUrl } from '../modules/state.js';

/**
 * Flowchart renderer — SatisfactoryTools-inspired.
 * Left-to-right DAG with building/item icons on nodes,
 * item icons on edges, zoom + pan + drag.
 */

const NODE_W = 240;
const NODE_H = 68;
const RAW_W = 160;
const RAW_H = 48;
const H_GAP = 180;
const V_GAP = 48;
const COLORS = {
    recipeBg: '#DF691A',
    recipeBorder: '#b35415',
    recipeText: '#fff',
    rawBg: '#4E5D6C',
    rawBorder: '#39444f',
    rawText: '#e2e8f0',
    outputBg: '#4E5D6C',
    outputBorder: '#39444f',
    outputText: '#fff',
    edge: '#94a3b8',
    edgeText: '#e2e8f0',
    canvasBg: '#2B3E50'
};

let nodes = [];
let edges = [];
let dragNode = null;
let dragOffset = { x: 0, y: 0 };
let pan = { x: 50, y: 50 };
let zoom = 1;
let imageCache = new Map();
let hoveredNode = null;

export function renderFlowchart() { return ''; }

export function initFlowchart(result, gameData) {
    const canvas = document.getElementById('flowchart-canvas');
    if (!canvas) return;

    let isDragging = false;
    let lastMouse = { x: 0, y: 0 };
    let tooltipDiv = document.getElementById('flowchart-tooltip');
    if (!tooltipDiv) {
        tooltipDiv = document.createElement('div');
        tooltipDiv.id = 'flowchart-tooltip';
        tooltipDiv.className = 'flowchart-tooltip';
        document.body.appendChild(tooltipDiv);
    }
    tooltipDiv.style.display = 'none';

    // Reset state
    imageCache = new Map();
    pan = { x: 50, y: 50 };
    zoom = 1;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = canvas.offsetHeight * dpr;
        draw(ctx, canvas, dpr, gameData);
    };
    window.addEventListener('resize', resize);
    resize();
    const ctx = canvas.getContext('2d');

    buildGraph(result, gameData);
    layoutGraph();

    // Mouse events
    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        isDragging = true;
        lastMouse = { x: mx, y: my };
        canvas.style.cursor = 'grabbing';
    });

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (isDragging) {
            pan.x += mx - lastMouse.x;
            pan.y += my - lastMouse.y;
            draw(ctx, canvas, dpr, gameData);
        } else {
            const graphX = (mx - pan.x) / zoom;
            const graphY = (my - pan.y) / zoom;
            let found = null;
            for (const node of nodes) {
                const nw = node.type === 'recipe' || node.type === 'output' ? NODE_W : RAW_W;
                const nh = node.type === 'recipe' || node.type === 'output' ? NODE_H : RAW_H;
                if (graphX >= node.x && graphX <= node.x + nw && graphY >= node.y && graphY <= node.y + nh) {
                    found = node;
                    break;
                }
            }
            if (found !== hoveredNode) {
                hoveredNode = found;
                if (hoveredNode) {
                    showTooltip(hoveredNode, e.clientX, e.clientY);
                } else {
                    tooltipDiv.style.display = 'none';
                }
                draw(ctx, canvas, dpr, gameData);
            } else if (hoveredNode) {
                tooltipDiv.style.left = (e.clientX + 15) + 'px';
                tooltipDiv.style.top = (e.clientY + 15) + 'px';
            }
        }
        lastMouse = { x: mx, y: my };
    });

    canvas.addEventListener('mouseup', () => { isDragging = false; canvas.style.cursor = 'grab'; });
    canvas.addEventListener('mouseleave', () => { 
        isDragging = false; 
        if (hoveredNode) { hoveredNode = null; tooltipDiv.style.display = 'none'; draw(ctx, canvas, dpr, gameData); }
        canvas.style.cursor = 'grab'; 
    });

    function showTooltip(node, x, y) {
        if (!node.tooltipData) return;
        const d = node.tooltipData;
        let html = `<strong>${node.label1}</strong><br/>`;
        if (d.machines) {
            html += `<div style="font-size:12px;margin-bottom:8px">${d.machineCountRaw}x ${d.buildingName} at ${d.clockSpeed}% clock speed<br/>Needed power: ${d.power} MW</div>`;
        }
        if (d.inputs && d.inputs.length > 0) {
            html += `<div style="margin-bottom:4px">`;
            for (const inp of d.inputs) html += `<div><strong>IN:</strong> ${inp.rate} / min - ${inp.name}</div>`;
            html += `</div>`;
        }
        if (d.outputs && d.outputs.length > 0) {
            html += `<div>`;
            for (const out of d.outputs) html += `<div><strong>OUT:</strong> ${out.rate} / min - ${out.name}</div>`;
            html += `</div>`;
        }
        tooltipDiv.innerHTML = html;
        tooltipDiv.style.display = 'block';
        tooltipDiv.style.left = (x + 15) + 'px';
        tooltipDiv.style.top = (y + 15) + 'px';
    }

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

    for (const step of result.steps) {
        const building = step.buildingId ? gameData.buildings[step.buildingId] : null;
        const tooltipData = {
            machines: true,
            machineCountRaw: step.machineCountRaw.toFixed(3),
            buildingName: building?.name || 'Machine',
            clockSpeed: step.clockSpeed,
            power: (step.power || 0).toFixed(3),
            inputs: step.inputs.map(i => ({ name: gameData.items[i.itemId]?.name || i.itemId, rate: (i.ratePerMachine * step.machineCountRaw).toFixed(3) })),
            outputs: step.outputs.map(o => ({ name: gameData.items[o.itemId]?.name || o.itemId, rate: (o.ratePerMachine * step.machineCountRaw).toFixed(3) }))
        };
        const node = {
            id: step.recipeId + '__' + step.targetItemId,
            type: 'recipe',
            label1: step.recipeName,
            label2: `${Math.ceil(step.machineCountRaw)}× ${building?.name || 'Machine'}`,
            label3: `${step.clockSpeed}%`,
            buildingImg: building?.image ? getImageUrl(building.image) : null,
            tooltipData: tooltipData,
            x: 0, y: 0
        };
        nodes.push(node);
        stepNodes.set(node.id, node);
    }

    for (const [itemId, rate] of Object.entries(result.rawResources)) {
        const item = gameData.items[itemId];
        nodes.push({
            id: 'raw__' + itemId,
            type: 'raw',
            label1: item?.name || itemId,
            label2: fmtRate(rate, itemId, gameData),
            itemImg: item?.image ? getImageUrl(item.image) : null,
            tooltipData: { machines: false, outputs: [{ name: item?.name || itemId, rate: rate.toFixed(3) }] },
            x: 0, y: 0
        });
    }

    const targetItem = gameData.items[result.targetItemId];
    nodes.push({
        id: 'output__' + result.targetItemId,
        type: 'output',
        label1: targetItem?.name || result.targetItemId,
        label2: fmtRate(result.targetRate, result.targetItemId, gameData),
        itemImg: targetItem?.image ? getImageUrl(targetItem.image) : null,
        tooltipData: { machines: false, inputs: [{ name: targetItem?.name || result.targetItemId, rate: result.targetRate.toFixed(3) }] },
        x: 0, y: 0
    });

    for (const step of result.steps) {
        const stepNode = stepNodes.get(step.recipeId + '__' + step.targetItemId);
        if (!stepNode) continue;
        for (const inp of step.inputs) {
            const sourceRaw = nodes.find(n => n.id === 'raw__' + inp.itemId);
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
                from: stepNode.id, to: 'output__' + result.targetItemId,
                label: fmtRate(result.targetRate, result.targetItemId, gameData),
                itemName: targetItem?.name || result.targetItemId,
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
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.canvasBg;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Group backwards edges to calculate proper bottom offsets
    const backwardsEdges = edges.filter(e => {
        const f = nodes.find(n => n.id === e.from);
        const t = nodes.find(n => n.id === e.to);
        return f && t && (f.x >= t.x);
    });    // Edges
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

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        
        let midX, midY;
        
        // Cycle routing (backwards edge) - Circular/Bezier sweeping arc
        if (x1 >= x2) {
            const edgeIndex = backwardsEdges.indexOf(edge);
            const bottomY = Math.max(y1, y2) + 80 + (edgeIndex * 40); // Offset each edge so they don't overlap
            
            ctx.bezierCurveTo(x1 + 60, y1, x1 + 60, bottomY, (x1 + x2) / 2, bottomY);
            ctx.bezierCurveTo(x2 - 60, bottomY, x2 - 60, y2, x2, y2);
            
            midX = (x1 + x2) / 2;
            midY = bottomY;
        } else {
            // Forward edge - Direct straight line
            ctx.lineTo(x2, y2);
            midX = (x1 + x2) / 2;
            midY = (y1 + y2) / 2;
        }

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
        // Draw item icon on edge
        if (edge.itemImg && imageCache.has(edge.itemImg)) {
            const img = imageCache.get(edge.itemImg);
            ctx.drawImage(img, midX - 10, midY - 24, 20, 20);
        }

        ctx.font = '600 13px Inter, sans-serif';
        ctx.fillStyle = COLORS.edgeText;
        ctx.textAlign = 'center';
        ctx.fillText(edge.label, midX, midY + 12);
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

        ctx.shadowColor = hoveredNode === node ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = hoveredNode === node ? 12 : 8;
        ctx.shadowOffsetY = hoveredNode === node ? 0 : 2;

        ctx.beginPath();
        roundRect(ctx, node.x, node.y, nw, nh, 8);
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.strokeStyle = hoveredNode === node ? '#fff' : border;
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
        ctx.font = 'bold 13px Inter, sans-serif';
        ctx.fillText(truncate(node.label1, 18), textX, node.y + nh / 2 - (node.label3 ? 10 : (node.label2 ? 6 : 2)));

        if (node.label2) {
            ctx.font = '12px Inter, sans-serif';
            ctx.fillStyle = isRecipe ? 'rgba(255,255,255,0.85)' : COLORS.rawText;
            ctx.fillText(truncate(node.label2, 22), textX, node.y + nh / 2 + 6);
        }
        if (node.label3) {
            ctx.font = '10px JetBrains Mono, monospace';
            ctx.fillStyle = isRecipe ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.5)';
            ctx.fillText(node.label3, textX, node.y + nh / 2 + 20);
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
