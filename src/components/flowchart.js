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
// Identity of the last result we built a graph for. Reuse the cached layout
// (nodes/edges/pan/zoom/drag positions) when reinitialising for the same result —
// e.g. switching tabs and coming back, or toggling fullscreen.
let lastResult = null;

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

    const sameResult = result === lastResult && nodes.length > 0;

    // Drag/hover state always resets across init calls; pan/zoom and the
    // graph itself only reset when the underlying result has changed.
    dragNode = null;
    dragOffset = { x: 0, y: 0 };
    hoveredNode = null;

    if (!sameResult) {
        imageCache = new Map();
        pan = { x: 50, y: 50 };
        zoom = 1;
        buildGraph(result, gameData);
        layoutGraph();
        lastResult = result;
    }

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

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
            const machineLine = d.machineSplit
                ? `${d.machineSplit} ${d.buildingName} (${d.machineCountRaw} raw)`
                : `${d.machineCountRaw}x ${d.buildingName} at ${d.clockSpeed}% clock speed`;
            html += `<div style="font-size:12px;margin-bottom:8px">${machineLine}<br/>Needed power: ${d.power} MW</div>`;
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
        const split = splitMachines(step.machineCountRaw);
        const buildingName = building?.name || 'Machine';
        const machineLabel = split.partialPct > 0
            ? `${split.full}× @ 100% + 1× @ ${split.partialPct}%`
            : `${split.full}× @ 100%`;
        const tooltipData = {
            machines: true,
            machineCountRaw: step.machineCountRaw.toFixed(3),
            buildingName,
            clockSpeed: step.clockSpeed,
            machineSplit: machineLabel,
            power: (step.power || 0).toFixed(3),
            inputs: step.inputs.map(i => ({ name: gameData.items[i.itemId]?.name || i.itemId, rate: (i.ratePerMachine * step.machineCountRaw).toFixed(3) })),
            outputs: step.outputs.map(o => ({ name: gameData.items[o.itemId]?.name || o.itemId, rate: (o.ratePerMachine * step.machineCountRaw).toFixed(3) }))
        };
        const node = {
            id: step.recipeId + '__' + step.targetItemId,
            type: 'recipe',
            label1: step.recipeName,
            label2: `${buildingName} — ${machineLabel}`,
            label3: null,
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
        if (t.rate < 0.001) continue; // skip zero-rate targets (fully consumed internally)
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

    // Pre-compute byproduct allocations: for each (consumer, item) pair, how
    // much of the demand is satisfied by byproducts vs. the primary producer.
    // Byproduct rate is allocated proportionally across consumers by demand.
    const byAllocation = {}; // {consumerStepKey: {itemId: rate}}
    for (const producer of result.steps) {
        for (const out of producer.outputs) {
            if (out.itemId === producer.targetItemId) continue; // primary, not byproduct
            const byRate = out.ratePerMachine * producer.machineCountRaw;
            if (byRate < 1e-6) continue;
            const consumers = result.steps.filter(cs => cs !== producer && cs.inputs.find(i => i.itemId === out.itemId));
            if (consumers.length === 0) continue;
            let totalDemand = 0;
            for (const cs of consumers) {
                const inp = cs.inputs.find(i => i.itemId === out.itemId);
                totalDemand += inp.ratePerMachine * cs.machineCountRaw;
            }
            if (totalDemand <= 0) continue;
            for (const cs of consumers) {
                const inp = cs.inputs.find(i => i.itemId === out.itemId);
                const csDemand = inp.ratePerMachine * cs.machineCountRaw;
                const allocated = Math.min(csDemand, byRate * (csDemand / totalDemand));
                const key = cs.recipeId + '__' + cs.targetItemId;
                if (!byAllocation[key]) byAllocation[key] = {};
                byAllocation[key][out.itemId] = (byAllocation[key][out.itemId] || 0) + allocated;
            }
        }
    }

    for (const step of result.steps) {
        const stepNode = stepNodes.get(step.recipeId + '__' + step.targetItemId);
        if (!stepNode) continue;
        const stepKey = step.recipeId + '__' + step.targetItemId;
        for (const inp of step.inputs) {
            const sourceRaw = nodes.find(n => n.id === 'raw__' + inp.itemId);
            const sourceStep = findStepProducing(inp.itemId, result.steps, stepNodes);
            const source = sourceStep || sourceRaw;
            if (!source) continue;
            const fullDemand = inp.ratePerMachine * step.machineCountRaw;
            const byRate = byAllocation[stepKey]?.[inp.itemId] || 0;
            const rate = Math.max(0, fullDemand - byRate);
            if (rate < 0.001) continue; // entire demand satisfied by byproduct edge
            const item = gameData.items[inp.itemId];
            edges.push({
                from: source.id, to: stepNode.id,
                label: fmtRate(rate, inp.itemId, gameData),
                itemName: item?.name || inp.itemId,
                itemImg: item?.image ? getImageUrl(item.image) : null
            });
        }
        if (targetMap.has(step.targetItemId)) {
            const rate = targetMap.get(step.targetItemId);
            if (rate >= 0.001) { // skip if target was pruned (0-rate)
                const targetItem = gameData.items[step.targetItemId];
                edges.push({
                    from: stepNode.id, to: 'output__' + step.targetItemId,
                    label: fmtRate(rate, step.targetItemId, gameData),
                    itemName: targetItem?.name || step.targetItemId,
                    itemImg: targetItem?.image ? getImageUrl(targetItem.image) : null
                });
            }
        }
        // Byproduct edges: only for non-primary outputs (true byproducts).
        for (const out of step.outputs) {
            if (out.itemId === step.targetItemId) continue; // primary, handled by input loop
            if (targetMap.has(out.itemId)) continue;
            for (const cs of result.steps) {
                if (cs === step) continue;
                if (!cs.inputs.find(i => i.itemId === out.itemId)) continue;
                const cn = stepNodes.get(cs.recipeId + '__' + cs.targetItemId);
                if (!cn) continue;
                const csKey = cs.recipeId + '__' + cs.targetItemId;
                const allocated = byAllocation[csKey]?.[out.itemId] || 0;
                if (allocated < 0.001) continue;
                const item = gameData.items[out.itemId];
                edges.push({
                    from: stepNode.id, to: cn.id,
                    label: fmtRate(allocated, out.itemId, gameData),
                    itemName: item?.name || out.itemId,
                    itemImg: item?.image ? getImageUrl(item.image) : null
                });
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
        if (step.targetItemId === itemId) {
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

    // Adaptive edge routing: each edge attaches to whichever side of source &
    // target makes the most natural connection given their relative position.
    // Endpoints can be top/bottom/left/right. Bezier control handles pull
    // outward from the chosen side, so the curve always exits perpendicular
    // to the box edge — which gracefully handles dragged-around nodes.

    // Pre-compute bidirectional pairs so we can offset them to avoid overlap.
    const biDirectional = new Set();
    for (const e1 of edges) {
        if (edges.some(e2 => e2.from === e1.to && e2.to === e1.from)) {
            biDirectional.add(e1.from + '→' + e1.to);
        }
    }

    for (const edge of edges) {
        const fromNode = nodes.find(n => n.id === edge.from);
        const toNode = nodes.find(n => n.id === edge.to);
        if (!fromNode || !toNode) continue;

        const exitSide = pickSide(fromNode, toNode);
        const enterSide = pickSide(toNode, fromNode);
        const fromC = nodeCenter(fromNode);
        const toC = nodeCenter(toNode);
        const p1 = attachPoint(fromNode, exitSide, toC);
        const p2 = attachPoint(toNode, enterSide, fromC);
        const isCycle = biDirectional.has(edge.from + '→' + edge.to);

        // Forward edges: straight diagonal lines. Cycles: cubic bezier so the
        // two arrows in a bidirectional pair don't overlap.
        let c1, c2;
        if (isCycle) {
            const dist = Math.min(180, Math.max(60, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.45));
            const o1 = sideNormal(exitSide, dist);
            const o2 = sideNormal(enterSide, dist);
            c1 = { x: p1.x + o1.x, y: p1.y + o1.y };
            c2 = { x: p2.x + o2.x, y: p2.y + o2.y };
            const OFFSET = 20;
            const dx = toC.x - fromC.x;
            const dy = toC.y - fromC.y;
            const len = Math.hypot(dx, dy) || 1;
            const px = -dy / len * OFFSET;
            const py =  dx / len * OFFSET;
            p1.x += px; p1.y += py;
            p2.x += px; p2.y += py;
            c1.x += px; c1.y += py;
            c2.x += px; c2.y += py;
        }

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        if (isCycle) {
            ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p2.x, p2.y);
        } else {
            ctx.lineTo(p2.x, p2.y);
        }
        ctx.strokeStyle = COLORS.edge;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Arrow at target endpoint, oriented along edge tangent at the end.
        const tanX = isCycle ? (p2.x - c2.x) : (p2.x - p1.x);
        const tanY = isCycle ? (p2.y - c2.y) : (p2.y - p1.y);
        drawArrow(ctx, p2.x, p2.y, tanX, tanY);

        // Label position: midpoint of curve (cycles) or straight line (forward)
        let midX, midY;
        if (isCycle) {
            const t = 0.5, mt = 1 - t;
            midX = mt*mt*mt*p1.x + 3*mt*mt*t*c1.x + 3*mt*t*t*c2.x + t*t*t*p2.x;
            midY = mt*mt*mt*p1.y + 3*mt*mt*t*c1.y + 3*mt*t*t*c2.y + t*t*t*p2.y;
        } else {
            midX = (p1.x + p2.x) / 2;
            midY = (p1.y + p2.y) / 2;
        }

        // Edge label with item icon
        if (edge.itemImg) {
            const img = imageCache.get(edge.itemImg);
            if (img) ctx.drawImage(img, midX - 12, midY - 28, 24, 24);
        }

        ctx.font = '600 15px Inter, sans-serif';
        ctx.fillStyle = COLORS.edgeText;
        ctx.textAlign = 'center';
        ctx.fillText(edge.label, midX, midY + 14);
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
                const iconSize = isRecipe ? 36 : 28;
                ctx.drawImage(img, node.x + 8, node.y + (nh - iconSize) / 2, iconSize, iconSize);
            }
        }

        const textX = iconUrl ? node.x + 50 : node.x + nw / 2;
        const align = iconUrl ? 'left' : 'center';
        ctx.fillStyle = textColor;
        ctx.textAlign = align;
        ctx.font = 'bold 16px Inter, sans-serif';
        ctx.fillText(truncate(node.label1, 14), textX, node.y + nh / 2 - (node.label3 ? 12 : (node.label2 ? 7 : 2)));

        if (node.label2) {
            ctx.font = '14px Inter, sans-serif';
            ctx.fillStyle = isRecipe ? 'rgba(255,255,255,0.85)' : COLORS.rawText;
            ctx.fillText(truncate(node.label2, 18), textX, node.y + nh / 2 + 8);
        }
        if (node.label3) {
            ctx.font = '12px JetBrains Mono, monospace';
            ctx.fillStyle = isRecipe ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.5)';
            ctx.fillText(node.label3, textX, node.y + nh / 2 + 24);
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

/**
 * Split a fractional machine count into N full-clock machines + 1 partial.
 * E.g. 12.4 → { full: 12, partialPct: 40 }. 12.0 → { full: 12, partialPct: 0 }.
 */
function splitMachines(machineCountRaw) {
    const whole = Math.floor(machineCountRaw + 1e-9);
    const partial = machineCountRaw - whole;
    if (partial < 0.001) return { full: whole, partialPct: 0 };
    return { full: whole, partialPct: Math.round(partial * 10000) / 100 };
}

function nodeSize(node) {
    const isBig = node.type === 'recipe' || node.type === 'output';
    return { w: isBig ? NODE_W : RAW_W, h: isBig ? NODE_H : RAW_H };
}

function nodeCenter(node) {
    const { w, h } = nodeSize(node);
    return { x: node.x + w / 2, y: node.y + h / 2 };
}

/**
 * Pick which side of `fromNode` to attach an edge to, based on the relative
 * position of `toNode`. Side is whichever axis (x or y) has the larger gap
 * between the centers — so a target far to the right exits "right", a target
 * directly below exits "bottom", etc.
 */
function pickSide(fromNode, toNode) {
    const fc = nodeCenter(fromNode);
    const tc = nodeCenter(toNode);
    const dx = tc.x - fc.x;
    const dy = tc.y - fc.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
    return dy >= 0 ? 'bottom' : 'top';
}

/**
 * Attach an edge to a side of `node`, but slide the attachment point along
 * that side toward the other endpoint (the "toward" target). This spreads
 * out incoming/outgoing edges on a node with multiple connections instead of
 * stacking them all at the side midpoint.
 *
 * Falls back to the side midpoint when no toward point is given.
 */
function attachPoint(node, side, toward) {
    const { w, h } = nodeSize(node);
    const margin = 12;
    if (side === 'right' || side === 'left') {
        const x = side === 'right' ? node.x + w : node.x;
        const yMin = node.y + margin;
        const yMax = node.y + h - margin;
        const y = toward ? Math.min(yMax, Math.max(yMin, toward.y)) : node.y + h / 2;
        return { x, y };
    } else {
        const y = side === 'top' ? node.y : node.y + h;
        const xMin = node.x + margin;
        const xMax = node.x + w - margin;
        const x = toward ? Math.min(xMax, Math.max(xMin, toward.x)) : node.x + w / 2;
        return { x, y };
    }
}

function sideNormal(side, dist) {
    if (side === 'right')  return { x: +dist, y: 0 };
    if (side === 'left')   return { x: -dist, y: 0 };
    if (side === 'top')    return { x: 0, y: -dist };
    return                       { x: 0, y: +dist };
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
