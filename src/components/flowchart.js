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
let currentResizeHandler = null;
let redrawScheduled = false;

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
    dragNode = null;
    dragOffset = { x: 0, y: 0 };
    hoveredNode = null;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    buildGraph(result, gameData);
    layoutGraph();

    const requestRedraw = () => {
        if (redrawScheduled) return;
        redrawScheduled = true;
        requestAnimationFrame(() => {
            redrawScheduled = false;
            draw(ctx, canvas, dpr, gameData);
        });
    };
    preloadImages(requestRedraw);

    const resize = () => {
        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = canvas.offsetHeight * dpr;
        draw(ctx, canvas, dpr, gameData);
    };
    if (currentResizeHandler) window.removeEventListener('resize', currentResizeHandler);
    currentResizeHandler = resize;
    window.addEventListener('resize', resize);
    resize();

    const nodeAt = (graphX, graphY) => {
        for (const node of nodes) {
            const nw = node.type === 'recipe' || node.type === 'output' ? NODE_W : RAW_W;
            const nh = node.type === 'recipe' || node.type === 'output' ? NODE_H : RAW_H;
            if (graphX >= node.x && graphX <= node.x + nw && graphY >= node.y && graphY <= node.y + nh) {
                return node;
            }
        }
        return null;
    };

    // Mouse events
    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const graphX = (mx - pan.x) / zoom;
        const graphY = (my - pan.y) / zoom;

        const hit = nodeAt(graphX, graphY);
        if (hit) {
            // Drag the node (graph-space)
            dragNode = hit;
            dragOffset = { x: graphX - hit.x, y: graphY - hit.y };
            canvas.style.cursor = 'grabbing';
            tooltipDiv.style.display = 'none';
        } else {
            // Pan the canvas (screen-space)
            isDragging = true;
            canvas.style.cursor = 'grabbing';
        }
        lastMouse = { x: mx, y: my };
    });

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (dragNode) {
            const graphX = (mx - pan.x) / zoom;
            const graphY = (my - pan.y) / zoom;
            dragNode.x = graphX - dragOffset.x;
            dragNode.y = graphY - dragOffset.y;
            draw(ctx, canvas, dpr, gameData);
        } else if (isDragging) {
            pan.x += mx - lastMouse.x;
            pan.y += my - lastMouse.y;
            draw(ctx, canvas, dpr, gameData);
        } else {
            const graphX = (mx - pan.x) / zoom;
            const graphY = (my - pan.y) / zoom;
            const found = nodeAt(graphX, graphY);
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

    canvas.addEventListener('mouseup', () => {
        dragNode = null;
        isDragging = false;
        canvas.style.cursor = 'grab';
    });
    canvas.addEventListener('mouseleave', () => {
        dragNode = null;
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

    // Support multi-target plans. Fall back to single-target shape for older callers.
    const targets = result.targets && result.targets.length > 0
        ? result.targets
        : [{ itemId: result.targetItemId, rate: result.targetRate }];
    const targetMap = new Map(targets.map(t => [t.itemId, t.rate]));

    for (const t of targets) {
        const targetItem = gameData.items[t.itemId];
        nodes.push({
            id: 'output__' + t.itemId,
            type: 'output',
            label1: targetItem?.name || t.itemId,
            label2: fmtRate(t.rate, t.itemId, gameData),
            itemImg: targetItem?.image ? getImageUrl(targetItem.image) : null,
            tooltipData: { machines: false, inputs: [{ name: targetItem?.name || t.itemId, rate: t.rate.toFixed(3) }] },
            x: 0, y: 0
        });
    }

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
        if (targetMap.has(step.targetItemId)) {
            const rate = targetMap.get(step.targetItemId);
            const targetItem = gameData.items[step.targetItemId];
            edges.push({
                from: stepNode.id, to: 'output__' + step.targetItemId,
                label: fmtRate(rate, step.targetItemId, gameData),
                itemName: targetItem?.name || step.targetItemId,
                itemImg: targetItem?.image ? getImageUrl(targetItem.image) : null
            });
        }
        for (const out of step.outputs) {
            if (targetMap.has(out.itemId)) continue;
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

    // Direct edge from raw to output for any target with no producing step (e.g. target IS a raw resource)
    for (const t of targets) {
        if (!result.rawResources || !result.rawResources[t.itemId]) continue;
        const stepProduced = result.steps.some(s => s.targetItemId === t.itemId);
        if (stepProduced) continue;
        const targetItem = gameData.items[t.itemId];
        edges.push({
            from: 'raw__' + t.itemId,
            to: 'output__' + t.itemId,
            label: fmtRate(t.rate, t.itemId, gameData),
            itemName: targetItem?.name || t.itemId,
            itemImg: targetItem?.image ? getImageUrl(targetItem.image) : null
        });
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

    // Classify edges. A "backward" edge is a cycle: target's left edge is at or
    // before source's right edge, so a straight diagonal would overlap nodes.
    const isBackward = (edge) => {
        const f = nodes.find(n => n.id === edge.from);
        const t = nodes.find(n => n.id === edge.to);
        if (!f || !t) return false;
        const fW = f.type === 'recipe' || f.type === 'output' ? NODE_W : RAW_W;
        return (f.x + fW) >= t.x;
    };
    const backwardsEdges = edges.filter(isBackward);

    for (const edge of edges) {
        const fromNode = nodes.find(n => n.id === edge.from);
        const toNode = nodes.find(n => n.id === edge.to);
        if (!fromNode || !toNode) continue;
        const fromW = fromNode.type === 'recipe' || fromNode.type === 'output' ? NODE_W : RAW_W;
        const fromH = fromNode.type === 'recipe' || fromNode.type === 'output' ? NODE_H : RAW_H;
        const toW = toNode.type === 'recipe' || toNode.type === 'output' ? NODE_W : RAW_W;
        const toH = toNode.type === 'recipe' || toNode.type === 'output' ? NODE_H : RAW_H;

        let x1, y1, x2, y2, midX, midY, tanX, tanY;

        if (isBackward(edge)) {
            // Cycle: exit source's BOTTOM, enter target's BOTTOM. Avoids the right side.
            x1 = fromNode.x + fromW / 2;
            y1 = fromNode.y + fromH;
            x2 = toNode.x + toW / 2;
            y2 = toNode.y + toH;

            const edgeIndex = backwardsEdges.indexOf(edge);
            const bottomY = Math.max(y1, y2) + 70 + (edgeIndex * 36);
            const c1x = x1, c1y = bottomY;
            const c2x = x2, c2y = bottomY;

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x2, y2);

            midX = (x1 + x2) / 2;
            midY = bottomY;
            // Tangent at end of cubic bezier = end - lastControl
            tanX = x2 - c2x;
            tanY = y2 - c2y;
        } else {
            // Forward edge: source.right-center → target.left-center, straight diagonal.
            x1 = fromNode.x + fromW;
            y1 = fromNode.y + fromH / 2;
            x2 = toNode.x;
            y2 = toNode.y + toH / 2;

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);

            midX = (x1 + x2) / 2;
            midY = (y1 + y2) / 2;
            tanX = x2 - x1;
            tanY = y2 - y1;
        }

        ctx.strokeStyle = COLORS.edge;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Arrow at target endpoint, oriented along edge tangent.
        drawArrow(ctx, x2, y2, tanX, tanY);

        // Edge label with item icon
        if (edge.itemImg) {
            const img = imageCache.get(edge.itemImg);
            if (img) ctx.drawImage(img, midX - 10, midY - 24, 20, 20);
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
        if (iconUrl) {
            const img = imageCache.get(iconUrl);
            if (img) {
                const iconSize = isRecipe ? 28 : 22;
                ctx.drawImage(img, node.x + 8, node.y + (nh - iconSize) / 2, iconSize, iconSize);
            }
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

function drawArrow(ctx, tipX, tipY, tanX, tanY) {
    const mag = Math.hypot(tanX, tanY) || 1;
    const ux = tanX / mag;
    const uy = tanY / mag;
    const len = 12;
    const halfW = 5;
    const px = -uy;
    const py = ux;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - ux * len + px * halfW, tipY - uy * len + py * halfW);
    ctx.lineTo(tipX - ux * len - px * halfW, tipY - uy * len - py * halfW);
    ctx.closePath();
    ctx.fillStyle = COLORS.edge;
    ctx.fill();
}

function preloadImages(onImageReady) {
    const urls = new Set();
    for (const node of nodes) {
        if (node.buildingImg) urls.add(node.buildingImg);
        if (node.itemImg) urls.add(node.itemImg);
    }
    for (const edge of edges) {
        if (edge.itemImg) urls.add(edge.itemImg);
    }

    for (const url of urls) {
        if (imageCache.has(url)) continue;
        // Mark as in-flight so we don't double-load
        imageCache.set(url, null);
        const img = new Image();
        img.onload = () => {
            imageCache.set(url, img);
            onImageReady();
        };
        img.onerror = () => {
            imageCache.set(url, null);
        };
        img.src = url;
    }
}
