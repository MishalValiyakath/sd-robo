const modelSelect = document.getElementById('model');
const queryInput = document.getElementById('query');
const jsonOutput = document.getElementById('json-output');
const diagramOutput = document.getElementById('diagram-output');
const diagramLoading = document.getElementById('diagram-loading');
const pageLoader = document.getElementById('page-loader');
const summaryVariables = document.getElementById('summary-variables');
const summaryLoops = document.getElementById('summary-loops');
const summaryRelationships = document.getElementById('summary-relationships');
const summaryBoundaries = document.getElementById('summary-boundaries');
const summaryHypotheses = document.getElementById('summary-hypotheses');
const statusEl = document.getElementById('status');
const portalVersionEl = document.getElementById('portal-version');
const pageShell = document.querySelector('.page-shell');
const toggleLeftPanelButton = document.getElementById('toggle-left-panel');
const zoomInButton = document.getElementById('zoom-in-button');
const zoomOutButton = document.getElementById('zoom-out-button');
const form = document.getElementById('sd-form');
const copyButton = document.getElementById('copy-button');
const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const tabContents = Array.from(document.querySelectorAll('.tab-content'));
let currentCyInstance = null;
let latestModelPayload = null;
const SUPPORTED_AGENT_VERSIONS = new Set(['v1', 'v2']);
const DEFAULT_CLD_ZOOM_MULTIPLIER = 1.2;
const activeVersion = getVersionFromUrl();

function normalizeVersion(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_AGENT_VERSIONS.has(normalized) ? normalized : 'v2';
}

function getVersionFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const queryValue = params.get('version') || params.get('v');
  const normalizedQueryVersion = String(queryValue || '').trim().toLowerCase();
  if (SUPPORTED_AGENT_VERSIONS.has(normalizedQueryVersion)) {
    return normalizedQueryVersion;
  }

  const [firstSegment = ''] = window.location.pathname
    .split('/')
    .filter(Boolean);

  return normalizeVersion(firstSegment);
}

async function fetchConfig() {
  const response = await fetch(`/api/${activeVersion}/config`);
  if (!response.ok) {
    throw new Error('Unable to load configuration');
  }
  return response.json();
}

function renderSelectOptions(select, values, labelFn) {
  select.innerHTML = '';
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value.alias || value;
    option.textContent = labelFn ? labelFn(value) : value;
    select.appendChild(option);
  });
}

function updateStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ffb4b4' : '#a9d1ff';
}

function setLeftPanelCollapsed(isCollapsed) {
  if (!pageShell || !toggleLeftPanelButton) {
    return;
  }

  pageShell.classList.toggle('left-collapsed', isCollapsed);
  toggleLeftPanelButton.innerHTML = `<span aria-hidden="true">${isCollapsed ? '>' : '<'}</span>`;
  toggleLeftPanelButton.setAttribute('aria-label', isCollapsed ? 'Expand left panel' : 'Collapse left panel');
  toggleLeftPanelButton.setAttribute('title', isCollapsed ? 'Expand left panel' : 'Collapse left panel');
  toggleLeftPanelButton.setAttribute('aria-expanded', String(!isCollapsed));
}

function toggleLeftPanel() {
  if (!pageShell) {
    return;
  }

  setLeftPanelCollapsed(!pageShell.classList.contains('left-collapsed'));
}

function activateTab(targetTab) {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === targetTab;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });

  tabContents.forEach((content) => {
    const isActive = content.id === `tab-${targetTab}`;
    content.classList.toggle('active', isActive);
  });

  if (targetTab === 'cld') {
    window.setTimeout(() => {
      if (latestModelPayload && !currentCyInstance) {
        renderDiagram(latestModelPayload);
      }

      if (currentCyInstance) {
        currentCyInstance.resize();
        currentCyInstance.fit();
        adjustDiagramZoom(DEFAULT_CLD_ZOOM_MULTIPLIER);
      }
    }, 40);
  }
}

function setDiagramLoading(isLoading) {
  diagramLoading.classList.toggle('hidden', !isLoading);
  if (isLoading) {
    diagramOutput.innerHTML = '<div class="empty-state">Generating diagram…</div>';
  }
}

function setPageLoading(isLoading) {
  pageLoader.classList.toggle('hidden', !isLoading);
}

function getZoomLimits(cy) {
  const minZoom = typeof cy.minZoom === 'function' ? cy.minZoom() : 0.1;
  const maxZoom = typeof cy.maxZoom === 'function' ? cy.maxZoom() : 10;
  return { minZoom, maxZoom };
}

function adjustDiagramZoom(multiplier) {
  if (!currentCyInstance || typeof currentCyInstance.zoom !== 'function') {
    return;
  }

  const currentZoom = currentCyInstance.zoom();
  if (typeof currentZoom !== 'number' || Number.isNaN(currentZoom)) {
    return;
  }

  const { minZoom, maxZoom } = getZoomLimits(currentCyInstance);
  const nextZoom = Math.max(minZoom, Math.min(maxZoom, currentZoom * multiplier));

  if (typeof currentCyInstance.extent === 'function') {
    const extent = currentCyInstance.extent();
    currentCyInstance.zoom({
      level: nextZoom,
      renderedPosition: {
        x: (extent.x1 + extent.x2) / 2,
        y: (extent.y1 + extent.y2) / 2,
      },
    });
    return;
  }

  currentCyInstance.zoom(nextZoom);
}

function prettyFormatJson(value) {
  if (!value) {
    return 'No JSON response available.';
  }
  return JSON.stringify(value, null, 2);
}

function createSvgNode(tagName, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tagName);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function getEllipseBoundaryPoint(x, y, width, height, angle) {
  const rx = width / 2;
  const ry = height / 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const scale = 1 / Math.sqrt(((dx * dx) / (rx * rx)) + ((dy * dy) / (ry * ry)));

  return {
    x: x + (dx * scale * rx),
    y: y + (dy * scale * ry),
  };
}

function renderSummary(model) {
  const boundaryConditions = model?.boundary_conditions;
  const dynamicHypotheses = Array.isArray(model?.dynamic_hypotheses) ? model.dynamic_hypotheses : [];
  const variables = Array.isArray(model?.variables) ? model.variables : [];
  const loops = Array.isArray(model?.loops) ? model.loops : [];
  const relationships = Array.isArray(model?.relationships) ? model.relationships : [];

  const loopVariableLookup = new Set(
    variables.flatMap((variable) => (variable?.name ? [variable.name] : []))
  );

  const buildLoopRelationships = (loop) => {
    const loopVariables = Array.isArray(loop?.variables) ? loop.variables : [];
    const included = new Set(loopVariables.filter((value) => loopVariableLookup.has(value)));

    return relationships.filter((relationship) => {
      const matchesSource = included.has(relationship.source);
      const matchesTarget = included.has(relationship.target);
      return matchesSource || matchesTarget;
    });
  };

  summaryVariables.innerHTML = variables.length
    ? variables.map((item) => `<li><strong>${item.name}</strong><span>${item.type}</span></li>`).join('')
    : '<li class="empty-item">No variables detected.</li>';

  summaryLoops.innerHTML = loops.length
    ? loops.map((item) => {
        const loopRelationships = buildLoopRelationships(item);
        const loopExplanation = (item?.explanation || '').trim();
        const explanationMarkup = loopExplanation
          ? `<p class="loop-explanation">${loopExplanation}</p>`
          : '<p class="loop-explanation loop-explanation-empty">No explanation provided for this loop.</p>';
        const relationshipMarkup = loopRelationships.length
          ? `<ul class="loop-relationship-list">${loopRelationships.map((relationship) => `
              <li>
                <span>${relationship.source} → ${relationship.target}</span>
                <span class="loop-relationship-badge ${relationship.polarity === '-' ? 'negative' : 'positive'}">${relationship.polarity}${relationship.delay ? ' ⏳' : ''}</span>
              </li>
            `).join('')}</ul>`
          : '<div class="empty-subitem">No relationships mapped inside this loop.</div>';

        return `
          <li class="loop-summary-item">
            <details>
              <summary>
                <span class="loop-summary-title"><strong>${item.id}</strong><span>${item.name}</span></span>
              </summary>
              <div class="loop-details-content">
                ${explanationMarkup}
                ${relationshipMarkup}
              </div>
            </details>
          </li>
        `;
      }).join('')
    : '<li class="empty-item">No loops detected.</li>';

  summaryRelationships.innerHTML = relationships.length
    ? relationships.map((item) => `
        <li class="relationship-item">
          <div class="relationship-path">
            <strong>${item.source}</strong>
            <span class="relationship-arrow">→</span>
            <strong>${item.target}</strong>
          </div>
          <span class="relationship-badge ${item.polarity === '-' ? 'negative' : 'positive'}">
            ${item.polarity}${item.delay ? ' ⏳' : ''}
          </span>
        </li>
      `).join('')
    : '<li class="empty-item">No relationships detected.</li>';

  const boundaryItems = [];

  if (Array.isArray(boundaryConditions)) {
    boundaryConditions
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .forEach((item) => {
        boundaryItems.push(`<li>${item}</li>`);
      });
  } else if (boundaryConditions && typeof boundaryConditions === 'object') {
    const summary = String(boundaryConditions.summary || '').trim();
    const included = Array.isArray(boundaryConditions.included) ? boundaryConditions.included.filter(Boolean) : [];
    const excluded = Array.isArray(boundaryConditions.excluded) ? boundaryConditions.excluded.filter(Boolean) : [];
    const timeHorizon = String(boundaryConditions.time_horizon || '').trim();

    if (summary) {
      boundaryItems.push(`<li><strong>Boundary Summary</strong><span>${summary}</span></li>`);
    }

    if (included.length) {
      boundaryItems.push(`
        <li>
          <strong>Included</strong>
          <ul class="boundary-sublist">${included.map((item) => `<li>${item}</li>`).join('')}</ul>
        </li>
      `);
    }

    if (excluded.length) {
      boundaryItems.push(`
        <li>
          <strong>Excluded</strong>
          <ul class="boundary-sublist">${excluded.map((item) => `<li>${item}</li>`).join('')}</ul>
        </li>
      `);
    }

    if (timeHorizon) {
      boundaryItems.push(`<li><strong>Time Horizon</strong><span>${timeHorizon}</span></li>`);
    }
  }

  summaryBoundaries.innerHTML = boundaryItems.length
    ? boundaryItems.join('')
    : '<li class="empty-item">No boundary conditions captured.</li>';

  summaryHypotheses.innerHTML = dynamicHypotheses.length
    ? dynamicHypotheses.map((item) => {
        const text = String(item?.hypothesis || '').trim();
        const loopsText = Array.isArray(item?.linked_loops) && item.linked_loops.length
          ? `Loops: ${item.linked_loops.join(', ')}`
          : '';
        const variablesText = Array.isArray(item?.linked_variables) && item.linked_variables.length
          ? `Variables: ${item.linked_variables.join(', ')}`
          : '';
        const confidenceText = typeof item?.confidence === 'number'
          ? `Confidence: ${item.confidence.toFixed(2)}`
          : '';
        const meta = [loopsText, variablesText, confidenceText].filter(Boolean).join(' | ');

        return `
          <li>
            <strong>${text || 'Hypothesis not specified.'}</strong>
            ${meta ? `<span>${meta}</span>` : ''}
          </li>
        `;
      }).join('')
    : '<li class="empty-item">No dynamic hypotheses captured.</li>';
}

function renderDiagram(model) {
  if (!model || !Array.isArray(model.variables) || !model.variables.length) {
    diagramOutput.innerHTML = '<div class="empty-state">No causal model variables were returned.</div>';
    return;
  }

  if (currentCyInstance) {
    currentCyInstance.destroy();
    currentCyInstance = null;
  }

  const variables = model.variables;
  const relationships = Array.isArray(model.relationships) ? model.relationships : [];
  const loops = Array.isArray(model.loops) ? model.loops : [];

  if (!window.cytoscape || !window.cytoscapeDagre) {
    diagramOutput.innerHTML = '<div class="empty-state">Diagram library failed to load.</div>';
    return;
  }

  if (typeof window.cytoscape.use === 'function') {
    window.cytoscape.use(window.cytoscapeDagre);
  }

  const relationshipLookup = new Map();
  const loopEdgeKeys = new Set();

  relationships.forEach((relationship) => {
    relationshipLookup.set(`${relationship.source}::${relationship.target}`, relationship);
  });

  loops.forEach((loop) => {
    const loopVariables = Array.isArray(loop.variables) ? loop.variables : [];
    for (let index = 0; index < loopVariables.length; index += 1) {
      const current = loopVariables[index];
      const next = loopVariables[(index + 1) % loopVariables.length];
      if (!current || !next) {
        continue;
      }

      const direct = relationshipLookup.get(`${current}::${next}`);
      const reverse = relationshipLookup.get(`${next}::${current}`);

      if (direct) {
        loopEdgeKeys.add(`${current}::${next}`);
      } else if (reverse) {
        loopEdgeKeys.add(`${next}::${current}`);
      } else {
        loopEdgeKeys.add(`${current}::${next}`);
      }
    }
  });

  const container = document.createElement('div');
  container.id = 'cy';
  container.className = 'diagram-cy';
  container.style.width = '100%';
  container.style.height = '760px';
  diagramOutput.innerHTML = '';
  diagramOutput.appendChild(container);

  const elements = [];
  variables.forEach((variable) => {
    elements.push({
      data: {
        id: variable.name,
        label: variable.name,
      },
    });
  });

  relationships.forEach((relationship, index) => {
    const edgeKey = `${relationship.source}::${relationship.target}`;
    const isLoopEdge = loopEdgeKeys.has(edgeKey);
    const polaritySymbol = relationship.polarity === '-' ? '-' : '+';
    const edgeLabel = relationship.delay ? `${polaritySymbol} ⏳` : polaritySymbol;

    elements.push({
      data: {
        id: `edge-${index}-${relationship.source}-${relationship.target}`,
        source: relationship.source,
        target: relationship.target,
        polarity: relationship.polarity || '+',
        delay: Boolean(relationship.delay),
        label: edgeLabel,
        loopEdge: isLoopEdge,
      },
    });
  });

  const cy = window.cytoscape({
    container,
    elements,
    userZoomingEnabled: false,
    style: [
      {
        selector: 'node',
        style: {
          'shape': 'ellipse',
          'width': '230px',
          'height': '84px',
          'background-color': '#f2efe4',
          'border-width': 1.5,
          'border-color': '#6a7e9b',
          'color': '#1f2d42',
          'font-size': 24,
          'min-zoomed-font-size': 18,
          'font-weight': 600,
          'font-family': 'Source Sans 3, Segoe UI, sans-serif',
          'text-wrap': 'wrap',
          'text-max-width': '210px',
          'text-valign': 'center',
          'text-halign': 'center',
          'label': 'data(label)',
          'padding': '12px',
          'line-height': 1.3,
        },
      },
      {
        selector: 'edge',
        style: {
          'curve-style': 'bezier',
          'target-arrow-shape': 'triangle',
          'target-arrow-color': '#4f6179',
          'arrow-scale': 1.1,
          'line-color': (edge) => (edge.data('polarity') === '-' ? '#a44f4f' : '#3e6f86'),
          'width': (edge) => (edge.data('loopEdge') ? 4 : 2.5),
          'line-style': 'solid',
          'label': 'data(label)',
          'font-size': '11px',
          'font-family': 'Source Sans 3, Segoe UI, sans-serif',
          'text-rotation': 'autorotate',
          'color': '#25344d',
          'text-background-color': 'rgba(251, 249, 242, 0.94)',
          'text-background-opacity': 1,
          'text-background-padding': '2px',
          'text-border-color': 'rgba(79, 97, 121, 0.3)',
          'text-border-width': 1,
          'text-border-opacity': 1,
          'target-distance-from-node': 8,
          'source-distance-from-node': 8,
        },
      },
    ],
    layout: {
      name: 'dagre',
      fit: true,
      padding: 24,
      rankDir: 'LR',
      nodeSep: 48,
      rankSep: 80,
      animate: false,
      spacingFactor: 1.2,
    },
  });

  if (loops.length) {
    const loopLegend = document.createElement('div');
    loopLegend.className = 'loop-legend';

    loops.forEach((loop) => {
      const chip = document.createElement('span');
      const explanation = String(loop?.explanation || '').trim() || 'No explanation provided for this loop.';
      chip.className = 'loop-chip';
      chip.textContent = `${loop.id}: ${loop.name}`;
      chip.title = explanation;
      chip.setAttribute('aria-label', `${loop.id}: ${loop.name}. ${explanation}`);
      loopLegend.appendChild(chip);
    });

    diagramOutput.appendChild(loopLegend);
  }

  currentCyInstance = cy;

  cy.ready(() => {
    window.setTimeout(() => {
      cy.resize();
      cy.fit();
      adjustDiagramZoom(DEFAULT_CLD_ZOOM_MULTIPLIER);
    }, 25);
  });
}

async function copyJsonToClipboard() {
  const rawText = jsonOutput.textContent.trim();
  if (!rawText || rawText === 'Enter a problem statement and press the button to generate the model.' || rawText === 'Waiting for response...') {
    updateStatus('Nothing to copy yet.', true);
    return;
  }

  try {
    await navigator.clipboard.writeText(rawText);
    updateStatus('JSON copied to clipboard.');
  } catch (error) {
    updateStatus('Clipboard copy failed in this browser.', true);
  }
}

async function submitForm(event) {
  event.preventDefault();
  const model = modelSelect.value;
  const query = queryInput.value.trim();

  if (currentCyInstance) {
    currentCyInstance.destroy();
    currentCyInstance = null;
  }

  latestModelPayload = null;
  jsonOutput.textContent = 'Waiting for response...';
  setPageLoading(true);
  setDiagramLoading(true);
  updateStatus('Sending request…');

  try {
    const response = await fetch(`/api/${activeVersion}/sd-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, query }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Request failed');
    }

    const modelPayload = result.json || result.raw_output;
    latestModelPayload = modelPayload;
    jsonOutput.textContent = prettyFormatJson(modelPayload);
    renderSummary(modelPayload);
    renderDiagram(modelPayload);
    setDiagramLoading(false);
    setPageLoading(false);
    updateStatus('Loaded successfully.');
  } catch (error) {
    jsonOutput.textContent = '';
    diagramOutput.innerHTML = '<div class="empty-state">Unable to render the diagram.</div>';
    setDiagramLoading(false);
    setPageLoading(false);
    summaryVariables.innerHTML = '<li class="empty-item">No variables detected.</li>';
    summaryLoops.innerHTML = '<li class="empty-item">No loops detected.</li>';
    summaryRelationships.innerHTML = '<li class="empty-item">No relationships detected.</li>';
    summaryBoundaries.innerHTML = '<li class="empty-item">No boundary conditions captured.</li>';
    summaryHypotheses.innerHTML = '<li class="empty-item">No dynamic hypotheses captured.</li>';
    updateStatus(error.message, true);
  }
}

async function init() {
  try {
    setLeftPanelCollapsed(false);

    if (portalVersionEl) {
      portalVersionEl.textContent = activeVersion;
    }

    const config = await fetchConfig();
    renderSelectOptions(modelSelect, config.models, ({ alias, target }) => `${alias} → ${target}`);
  } catch (error) {
    updateStatus(error.message, true);
  }
}

tabButtons.forEach((button) => {
  button.addEventListener('click', () => activateTab(button.dataset.tab));
});

copyButton.addEventListener('click', copyJsonToClipboard);
if (toggleLeftPanelButton) {
  toggleLeftPanelButton.addEventListener('click', toggleLeftPanel);
}
if (zoomInButton) {
  zoomInButton.addEventListener('click', () => adjustDiagramZoom(1.15));
}
if (zoomOutButton) {
  zoomOutButton.addEventListener('click', () => adjustDiagramZoom(1 / 1.15));
}
form.addEventListener('submit', submitForm);
activateTab('summary');
init();
