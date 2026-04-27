import { fmt, fmtRate } from '../modules/state.js';

/**
 * Flowchart renderer for production chains.
 * Renders a left-to-right directed graph on canvas:
 * - Orange rectangles = recipe/machine nodes
 * - Dark rectangles = raw resource nodes
 * - Arrows = item flow with rates
 * Supports drag-to-move and pan.
 */

const NODE_W = 180;
const NODE_H = 60;
const RAW_W = 140;
const RAW_H = 44;
const H_GAP = 100;
const V_GAP = 28;
const COLORS = {
    recipeBg: '#d97706',
    recipeBorder: '#f59e0b',
    recipeText: '#fff',
    rawBg: '#1e293b',
    rawBorder: '#475569',
    rawText: '#94a3b8',
    outputBg: '#059669',
    outputBorder: '#10b981',
    outputText: '#fff',
    edge: '#64748b',
    edgeText: '#94a3b8',
    canvasBg: '#0f172a'
};

let nodes = [];
let edges = [];
let dragNode = null;
let dragOffset = { x: 0, y: 0 };
let pan = { x: 40, y: 40 };
let isPanning = false;
let panStart = { x: 0, y: 0 };

export function renderFlowchart() {
    return '';
}

export function initFlowchart(result, gameData) {
    const canvas = document.getElementById('flowchart-canvas');
    if (!canvas) return;

    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    buildGraph(result, gameData);
    layoutGraph();
    draw(ctx, canvas);

    // Event handlers
    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left - pan.x;
        const my = e.clientY - rect.top - pan.y;

        // Check if clicking on a node
        dragNode = null;
        for (const node of nodes) {
            const w = node.type === 'recipe' ? NODE_W : (node.type === 'output' ? NODE_W : RAW_W);
            const h = node.type === 'recipe' ? NODE_H : (node.type === 'output' ? NODE_H : RAW_H);
            if (mx >= node.x && mx <= node.x + w && my >= node.y && my <= node.y + h) {
                dragNode = node;
                dragOffset = { x: mx - node.x, y: my - node.y };
                canvas.style.cursor = 'grabbing';
                return;
            }
        }

        // Pan
        isPanning = true;
        panStart = { x: e.clientX - pan.x, y: e.clientY - pan.y };
        canvas.style.cursor = 'grabbing';
    });

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        if (dragNode) {
            const mx = e.clientX - rect.left - pan.x;
            const my = e.clientY - rect.top - pan.y;
            dragNode.x = mx - dragOffset.x;
            dragNode.y = my - dragOffset.y;
            draw(ctx, canvas);
        } else if (isPanning) {
            pan.x = e.clientX - panStart.x;
            pan.y = e.clientY - panStart.y;
            draw(ctx, canvas);
        }
    });

    canvas.addEventListener('mouseup', () => {
        dragNode = null;
        isPanning = false;
        canvas.style.cursor = 'grab';
    });

    canvas.addEventListener('mouseleave', () => {
        dragNode = null;
        isPanning = false;
        canvas.style.cursor = 'grab';
    });
}

function buildGraph(result, gameData) {
    nodes = [];
    edges = [];

    const stepNodes = new Map();
    const rawNodes = new Map();

    // Create recipe step nodes
    for (const step of result.steps) {
        const building = step.buildingId ? gameData.buildings[step.buildingId] : null;
        const node = {
            id: step.recipeId + '__' + step.targetItemId,
            type: 'recipe',
            label1: step.recipeName,
            label2: `${step.machineCount}× ${building?.name || 'Machine'}`,
            x: 0, y: 0
        };
        nodes.push(node);
        stepNodes.set(node.id, node);
    }

    // Create raw resource nodes
    for (const [itemId, rate] of Object.entries(result.rawResources)) {
        const name = gameData.items[itemId]?.name || itemId;
        const node = {
            id: 'raw__' + itemId,
            type: 'raw',
            label1: name,
            label2: fmtRate(rate, itemId, gameData),
            x: 0, y: 0
        };
        nodes.push(node);
        rawNodes.set(itemId, node);
    }

    // Create output node for final product
    const targetName = gameData.items[result.targetItemId]?.name || result.targetItemId;
    const outputNode = {
        id: 'output__' + result.targetItemId,
        type: 'output',
        label1: targetName,
        label2: fmtRate(result.targetRate, result.targetItemId, gameData),
        x: 0, y: 0
    };
    nodes.push(outputNode);

    // Create edges
    for (const step of result.steps) {
        const stepNode = stepNodes.get(step.recipeId + '__' + step.targetItemId);
        if (!stepNode) continue;

        // Inputs: raw resources → this step, or other steps → this step
        for (const inp of step.inputs) {
            const sourceRaw = rawNodes.get(inp.itemId);
            const sourceStep = findStepProducing(inp.itemId, result.steps, stepNodes);
            const source = sourceStep || sourceRaw;
            if (source) {
                const rate = inp.ratePerMachine * step.machineCountRaw;
                edges.push({
                    from: source.id,
                    to: stepNode.id,
                    label: fmtRate(rate, inp.itemId, gameData),
                    itemName: gameData.items[inp.itemId]?.name || inp.itemId
                });
            }
        }

        // If this step produces the final target, connect to output
        if (step.targetItemId === result.targetItemId) {
            edges.push({
                from: stepNode.id,
                to: outputNode.id,
                label: fmtRate(result.targetRate, result.targetItemId, gameData),
                itemName: targetName
            });
        }

        // Connect this step's outputs to consuming steps
        for (const out of step.outputs) {
            if (out.itemId === result.targetItemId) continue;
            // Find steps that consume this output
            for (const consumerStep of result.steps) {
                if (consumerStep === step) continue;
                const consumes = consumerStep.inputs.find(i => i.itemId === out.itemId);
                if (consumes) {
                    const consumerNode = stepNodes.get(consumerStep.recipeId + '__' + consumerStep.targetItemId);
                    if (consumerNode) {
                        // Check if edge already exists
                        const exists = edges.find(e => e.from === stepNode.id && e.to === consumerNode.id);
                        if (!exists) {
                            const rate = out.ratePerMachine * step.machineCountRaw;
                            edges.push({
                                from: stepNode.id,
                                to: consumerNode.id,
                                label: fmtRate(rate, out.itemId, gameData),
                                itemName: gameData.items[out.itemId]?.name || out.itemId
                            });
                        }
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
    // Simple layered layout (left-to-right)
    // Layer 0: raw resources
    // Layer 1..n: recipe steps by dependency depth
    // Last layer: output

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const incomingEdges = new Map();
    for (const e of edges) {
        if (!incomingEdges.has(e.to)) incomingEdges.set(e.to, []);
        incomingEdges.get(e.to).push(e.from);
    }

    // Compute layers via topological sort
    const layers = new Map();
    const visited = new Set();

    function getLayer(id) {
        if (layers.has(id)) return layers.get(id);
        if (visited.has(id)) return 0;
        visited.add(id);

        const incoming = incomingEdges.get(id) || [];
        if (incoming.length === 0) {
            layers.set(id, 0);
            return 0;
        }

        let maxParent = 0;
        for (const parentId of incoming) {
            maxParent = Math.max(maxParent, getLayer(parentId));
        }
        const layer = maxParent + 1;
        layers.set(id, layer);
        return layer;
    }

    for (const node of nodes) {
        getLayer(node.id);
    }

    // Group by layer
    const layerGroups = {};
    for (const node of nodes) {
        const l = layers.get(node.id) || 0;
        if (!layerGroups[l]) layerGroups[l] = [];
        layerGroups[l].push(node);
    }

    // Position
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
            node.x = x;
            node.y = y;
            y += h + V_GAP;
        }
    }
}

function draw(ctx, canvas) {
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.canvasBg;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(pan.x, pan.y);

    // Draw edges
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

        // Bezier curve
        const cpx = (x1 + x2) / 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(cpx, y1, cpx, y2, x2, y2);
        ctx.strokeStyle = COLORS.edge;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Arrow
        const angle = Math.atan2(y2 - y1, x2 - (cpx));
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 8, y2 - 5);
        ctx.lineTo(x2 - 8, y2 + 5);
        ctx.closePath();
        ctx.fillStyle = COLORS.edge;
        ctx.fill();

        // Edge label
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2 - 8;
        ctx.font = '10px Inter, sans-serif';
        ctx.fillStyle = COLORS.edgeText;
        ctx.textAlign = 'center';
        ctx.fillText(edge.itemName, midX, midY);
        ctx.fillText(edge.label, midX, midY + 12);
    }

    // Draw nodes
    for (const node of nodes) {
        const isRecipe = node.type === 'recipe';
        const isOutput = node.type === 'output';
        const w = isRecipe || isOutput ? NODE_W : RAW_W;
        const h = isRecipe || isOutput ? NODE_H : RAW_H;
        const bg = isOutput ? COLORS.outputBg : (isRecipe ? COLORS.recipeBg : COLORS.rawBg);
        const border = isOutput ? COLORS.outputBorder : (isRecipe ? COLORS.recipeBorder : COLORS.rawBorder);
        const textColor = isOutput ? COLORS.outputText : (isRecipe ? COLORS.recipeText : COLORS.rawText);

        // Shadow
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 2;

        // Rectangle
        ctx.beginPath();
        roundRect(ctx, node.x, node.y, w, h, 6);
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.strokeStyle = border;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.shadowColor = 'transparent';

        // Text
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.fillText(truncate(node.label1, 22), node.x + w / 2, node.y + h / 2 - (node.label2 ? 4 : 2));

        if (node.label2) {
            ctx.font = '10px Inter, sans-serif';
            ctx.fillStyle = isRecipe ? 'rgba(255,255,255,0.8)' : COLORS.rawText;
            ctx.fillText(truncate(node.label2, 24), node.x + w / 2, node.y + h / 2 + 12);
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
