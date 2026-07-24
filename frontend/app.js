/**
 * app.js — EBM Inteligência: Dashboard de Investidores
 * Consome dados via API Flask (http://localhost:5000)
 */

const API = 'http://localhost:5000/api';

// ── Utilitários de formatação ───────────────────────────────────
const formatCurrency = (value) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value ?? 0);

const formatPercent = (value) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value ?? 0) + '%';

// ── Estado global da aplicação ───────────────────────────────────
let state = {
  records: [],          // registros vindos da API (filtrados no servidor)
  dimensoes: null,      // listas para os dropdowns
};

// ── Grafismo de Rede (Manual de Marca EBM) ───────────────────────
function makeField(el, opts) {
  const { w, h, n, color, red, dist, lineOp, dotOp } = opts;
  const pts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h }));
  let html = '';
  for (let a = 0; a < pts.length; a++) {
    for (let b = a + 1; b < pts.length; b++) {
      const dx = pts[a].x - pts[b].x, dy = pts[a].y - pts[b].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < dist) {
        const o = ((1 - d / dist) * lineOp).toFixed(2);
        html += `<line x1="${pts[a].x.toFixed(1)}" y1="${pts[a].y.toFixed(1)}" x2="${pts[b].x.toFixed(1)}" y2="${pts[b].y.toFixed(1)}" stroke="${color}" stroke-width="1" opacity="${o}"/>`;
      }
    }
  }
  const redIdx = Math.floor(Math.random() * pts.length);
  pts.forEach((p, i) => {
    if (i === redIdx) html += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="${red}"/>`;
    else html += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(Math.random() * 1.5 + 1.2).toFixed(1)}" fill="${color}" opacity="${dotOp}"/>`;
  });
  el.setAttribute('viewBox', `0 0 ${w} ${h}`);
  el.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  el.innerHTML = html;
}

// ── Renderiza a tabela agrupada por empreendimento ────────────────
function renderTable(records) {
  const tbody = document.querySelector('#table-controle tbody');
  tbody.innerHTML = '';

  if (!records || records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--gray-400);">Nenhum dado encontrado para os filtros selecionados.</td></tr>';
    return;
  }

  // Agrupa por empreendimento
  const grouped = {};
  records.forEach(d => {
    const key = d.nome_empreendimento;
    if (!grouped[key]) grouped[key] = { items: [], valorInvestido: 0, aplInvestidor: 0, aplEmpreendimento: d.apl_empreendimento };
    grouped[key].items.push(d);
    grouped[key].valorInvestido += Number(d.valor_investido ?? 0);
    grouped[key].aplInvestidor += Number(d.apl_investidor ?? 0);
  });

  Object.entries(grouped).forEach(([emp, data]) => {
    const percTotal = data.aplEmpreendimento > 0
      ? (data.aplInvestidor / data.aplEmpreendimento) * 100
      : 0;

    // Linha mestre (totalizadora do empreendimento)
    const tr = document.createElement('tr');
    tr.className = 'expandable-row';
    tr.innerHTML = `
      <td><span class="icon-box">[-]</span> ${emp}</td>
      <td class="numeric"><strong>${formatCurrency(data.valorInvestido)}</strong></td>
      <td class="numeric"><strong>${formatCurrency(data.aplInvestidor)}</strong></td>
      <td class="numeric"><strong>${formatCurrency(data.aplEmpreendimento)}</strong></td>
      <td class="numeric"><strong>${formatPercent(percTotal)}</strong></td>
      <td style="text-align:center;">-</td>
    `;
    tbody.appendChild(tr);

    // Sub-linhas (investidores do empreendimento)
    data.items.forEach(item => {
      const trSub = document.createElement('tr');
      trSub.className = 'sub-row';
      trSub.innerHTML = `
        <td style="padding-left:40px;color:var(--gray-600);">${item.nome_investidor ?? '-'}</td>
        <td class="numeric">${formatCurrency(item.valor_investido)}</td>
        <td class="numeric">${formatCurrency(item.apl_investidor)}</td>
        <td class="numeric">${formatCurrency(item.apl_empreendimento)}</td>
        <td class="numeric">${formatPercent(item.perc_apl_comprometida)}</td>
        <td style="text-align:center;">${item.intermediador ?? 'N/A'}</td>
      `;
      tbody.appendChild(trSub);
    });

    // Toggle expandir/recolher
    tr.addEventListener('click', () => {
      const icon = tr.querySelector('.icon-box');
      const collapsing = icon.textContent === '[-]';
      icon.textContent = collapsing ? '[+]' : '[-]';
      let next = tr.nextElementSibling;
      while (next && next.classList.contains('sub-row')) {
        next.style.display = collapsing ? 'none' : 'table-row';
        next = next.nextElementSibling;
      }
    });
  });
}

// ── Atualiza os KPIs do header com dados reais da API ────────────
function updateKpis(kpis) {
  const totalEl = document.getElementById('kpi-total-investido');
  const aplEl   = document.getElementById('kpi-total-apl');
  const qtdEl   = document.getElementById('kpi-qtd-registros');
  if (totalEl) totalEl.textContent = `R$ ${formatCurrency(kpis.total_investido)}`;
  if (aplEl)   aplEl.textContent   = formatCurrency(kpis.total_apl);
  if (qtdEl)   qtdEl.textContent   = kpis.qtd_registros;
}

// ── Popula os dropdowns com dados das dimensões ──────────────────
function populateFilters(dimensoes) {
  const addOpts = (selectId, items) => {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    items.forEach(val => { if (val) sel.add(new Option(val, val)); });
  };

  addOpts('filter-empreendimento', dimensoes.empreendimentos.map(e => e.nome));
  addOpts('filter-investidor',     dimensoes.investidores.map(i => i.nome_investidor));
  addOpts('filter-tipo',           dimensoes.tipos_investimento);
  addOpts('filter-intermediador',  dimensoes.intermediadores);
}

// ── Busca dados filtrados e rerenderiza ──────────────────────────
async function fetchAndRender() {
  const tbody = document.querySelector('#table-controle tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--gray-400);">Carregando...</td></tr>';

  const params = new URLSearchParams();
  const emp  = document.getElementById('filter-empreendimento')?.value;
  const inv  = document.getElementById('filter-investidor')?.value;
  const lan  = document.getElementById('filter-lancado')?.value;
  const tipo = document.getElementById('filter-tipo')?.value;
  const intr = document.getElementById('filter-intermediador')?.value;

  if (emp  && emp  !== 'Todos') params.set('empreendimento',   emp);
  if (inv  && inv  !== 'Todos') params.set('investidor',       inv);
  if (lan  && lan  !== 'Todos') params.set('lancado',          lan);
  if (tipo && tipo !== 'Todos') params.set('tipo_investimento', tipo);
  if (intr && intr !== 'Todos') params.set('intermediador',    intr);

  try {
    const res  = await fetch(`${API}/controle?${params}`);
    const json = await res.json();
    updateKpis(json.kpis);
    renderTable(json.records);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--red);">Erro ao conectar na API. Verifique se o servidor está rodando.<br><small>${err.message}</small></td></tr>`;
  }
}

// ── KPIs 2026: Investimentos vs Meta ────────────────────────────
async function fetch2026Kpis() {
  try {
    const res  = await fetch(`${API}/kpis/2026`);
    const data = await res.json();

    const investidoEl = document.getElementById('kpi-2026-investido');
    const percLabel   = document.getElementById('kpi-2026-perc-label');
    const bar         = document.getElementById('kpi-2026-bar');

    if (!investidoEl) return;

    // Formata em "Mi" ou "R$ X,XX"
    const investido = parseFloat(data.investido_2026 || 0);
    const perc      = parseFloat(data.perc_atingido  || 0);

    const fmt = v => v >= 1_000_000
      ? `${(v / 1_000_000).toFixed(2).replace('.', ',')} Mi`
      : `R$ ${formatCurrency(v)}`;

    investidoEl.textContent = fmt(investido);
    if (percLabel) percLabel.textContent = `${perc.toFixed(1).replace('.', ',')}% da meta`;
    if (bar) {
      // Anima a barra após um pequeno delay
      setTimeout(() => {
        bar.style.width = `${Math.min(perc, 100)}%`;
      }, 200);
    }
  } catch (err) {
    console.error('Erro ao carregar KPIs 2026:', err);
  }
}

// ── Indicador 1: Gráfico de barras — Valor Investido por Ano ────
let chartInstance = null;

async function renderChartInvestidoPorAno() {
  try {
    const res  = await fetch(`${API}/grafico/investido-por-ano`);
    const json = await res.json();
    const dados = json.por_ano || [];

    const labels = dados.map(d => d.ano);
    const values = dados.map(d => parseFloat(d.total_investido || 0));

    // Tabela ao lado
    const tbody = document.querySelector('#table-investido-por-ano tbody');
    const totalEl = document.getElementById('kpi-total-graf');
    if (tbody) {
      tbody.innerHTML = dados.map(d => `
        <tr>
          <td>${d.ano}</td>
          <td class="numeric">R$ ${formatCurrency(d.total_investido)}</td>
        </tr>
      `).join('');
    }
    if (totalEl) totalEl.textContent = `R$ ${formatCurrency(json.total)}`;

    // Gráfico Chart.js
    const canvas = document.getElementById('chart-investido-por-ano');
    if (!canvas) return;
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Valor Investido (R$)',
          data: values,
          backgroundColor: 'rgba(12, 31, 85, 0.85)',
          borderColor: '#E30A12',
          borderWidth: 0,
          borderRadius: 4,
          hoverBackgroundColor: '#E30A12',
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `R$ ${formatCurrency(ctx.raw)}`
            }
          }
        },
        scales: {
          y: {
            ticks: {
              callback: val => {
                if (val >= 1_000_000) return `${(val/1_000_000).toFixed(0)} Mi`;
                if (val >= 1_000)    return `${(val/1_000).toFixed(0)} K`;
                return val;
              }
            },
            grid: { color: '#E9EDF3' }
          },
          x: { grid: { display: false } }
        }
      }
    });
  } catch (err) {
    console.error('Erro ao carregar gráfico por ano:', err);
  }
}

// ── Indicador 2: Tabela Acompanhamento de Empreendimentos ────────
async function renderAcompanhamento() {
  const tbody = document.querySelector('#table-acompanhamento tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:16px;color:var(--gray-400);">Carregando...</td></tr>';

  try {
    const res  = await fetch(`${API}/grafico/acompanhamento`);
    const rows = await res.json();

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Nenhum dado encontrado.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><strong>${r.nome_empreendimento ?? '-'}</strong></td>
        <td>${r.data_lancamento_tolerancia ?? '-'}</td>
        <td>${r.data_previsao_lancamento ?? '-'}</td>
        <td>${r.data_conclusao_tolerancia ?? '-'}</td>
        <td style="max-width:180px;white-space:normal;font-size:11px;">${r.penalidade_lancamento ?? '-'}</td>
        <td style="max-width:180px;white-space:normal;font-size:11px;">${r.penalidade_conclusao ?? '-'}</td>
        <td style="max-width:200px;white-space:normal;font-size:11px;">${r.plano_de_acao ?? '-'}</td>
        <td>${r.intermediador ?? '-'}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--red);">Erro ao carregar dados.</td></tr>`;
    console.error(err);
  }
}

// ── Tela Acompanhamento de Investidores (Fluxo de Entrada) ──────
const MESES_NOME = [
  "", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];

let acompDimensoesCarregadas = false;

async function renderTelaAcompanhamento() {
  const investidor     = document.getElementById('acomp-filter-investidor')?.value || '';
  const empreendimento = document.getElementById('acomp-filter-empreendimento')?.value || '';

  const params = new URLSearchParams();
  if (investidor)     params.append('investidor', investidor);
  if (empreendimento) params.append('empreendimento', empreendimento);

  try {
    const res = await fetch(`${API}/acompanhamento/receita?${params.toString()}`);
    const data = await res.json();

    // 1. Dimensoes para dropdowns
    if (!acompDimensoesCarregadas && data.dimensoes) {
      const selInv = document.getElementById('acomp-filter-investidor');
      const selEmp = document.getElementById('acomp-filter-empreendimento');

      if (selInv && data.dimensoes.investidores) {
        selInv.innerHTML = '<option value="">Todos</option>' +
          data.dimensoes.investidores.map(i => `<option value="${i}">${i}</option>`).join('');
      }
      if (selEmp && data.dimensoes.empreendimentos) {
        selEmp.innerHTML = '<option value="">Todos</option>' +
          data.dimensoes.empreendimentos.map(e => `<option value="${e}">${e}</option>`).join('');
      }
      acompDimensoesCarregadas = true;
    }

    // 2. KPIs
    const real = parseFloat(data.kpis?.total_realizado || 0);
    const areal = parseFloat(data.kpis?.total_a_realizar || 0);
    const tot = real + areal;

    const fmtMi = v => v >= 1_000_000
      ? `R$ ${(v / 1_000_000).toFixed(1).replace('.', ',')} Mi`
      : `R$ ${formatCurrency(v)}`;

    document.getElementById('acomp-kpi-realizado').textContent = fmtMi(real);
    document.getElementById('acomp-kpi-a-realizar').textContent = fmtMi(areal);
    document.getElementById('acomp-kpi-total').textContent = fmtMi(tot);

    // 3. Tabela Receita (Agrupada por Ano com detalhe por Mês)
    const tbodyReceita = document.getElementById('tbody-receita');
    const mensal = data.mensal || [];

    if (!mensal.length) {
      tbodyReceita.innerHTML = '<tr><td colspan="3" style="text-align:center;">Nenhum registro encontrado.</td></tr>';
    } else {
      // Agrupa por ano
      const porAno = {};
      mensal.forEach(r => {
        const a = r.ano;
        if (!porAno[a]) porAno[a] = { ano: a, receita: 0, acumuladaMax: 0, meses: [] };
        const rec = parseFloat(r.receita_mes || 0);
        const acum = parseFloat(r.receita_acumulada || 0);
        porAno[a].receita += rec;
        porAno[a].acumuladaMax = acum; // O ultimo mes do ano tem o acumulado ate o fim daquele ano
        porAno[a].meses.push(r);
      });

      let html = '';
      Object.keys(porAno).sort().forEach(ano => {
        const item = porAno[ano];
        html += `
          <tr class="row-group" onclick="this.classList.toggle('expanded'); document.querySelectorAll('.sub-acomp-${ano}').forEach(el => el.style.display = el.style.display === 'none' ? 'table-row' : 'none');" style="cursor:pointer; font-weight:600; background: var(--gray-50);">
            <td><span style="display:inline-block; width:16px;">▶</span> ${item.ano}</td>
            <td class="numeric">R$ ${formatCurrency(item.receita)}</td>
            <td class="numeric">R$ ${formatCurrency(item.acumuladaMax)}</td>
          </tr>
        `;

        item.meses.sort((a,b) => a.mes - b.mes).forEach(m => {
          html += `
            <tr class="sub-acomp-${ano}" style="display:none; background: #ffffff;">
              <td style="padding-left: 32px; color: var(--gray-600);">${MESES_NOME[m.mes] || m.mes}</td>
              <td class="numeric">R$ ${formatCurrency(m.receita_mes)}</td>
              <td class="numeric" style="color: var(--gray-600);">R$ ${formatCurrency(m.receita_acumulada)}</td>
            </tr>
          `;
        });
      });

      tbodyReceita.innerHTML = html;
      document.getElementById('acomp-total-receita').textContent = `R$ ${formatCurrency(real)}`;
      document.getElementById('acomp-total-acumulada').textContent = `R$ ${formatCurrency(real)}`;
    }

    // 4. Tabela A Receber
    const tbodyAReceber = document.getElementById('tbody-a-receber');
    const aReceber = data.a_receber || [];

    if (!aReceber.length) {
      tbodyAReceber.innerHTML = '<tr><td colspan="2" style="text-align:center;">Nenhum valor a receber.</td></tr>';
    } else {
      const porAnoARec = {};
      aReceber.forEach(r => {
        const a = r.ano;
        if (!porAnoARec[a]) porAnoARec[a] = { ano: a, total: 0, meses: [] };
        const val = parseFloat(r.valor || 0);
        porAnoARec[a].total += val;
        porAnoARec[a].meses.push(r);
      });

      let htmlARec = '';
      Object.keys(porAnoARec).sort().forEach(ano => {
        const item = porAnoARec[ano];
        htmlARec += `
          <tr class="row-group" onclick="this.classList.toggle('expanded'); document.querySelectorAll('.sub-arec-${ano}').forEach(el => el.style.display = el.style.display === 'none' ? 'table-row' : 'none');" style="cursor:pointer; font-weight:600; background: var(--gray-50);">
            <td><span style="display:inline-block; width:16px;">▶</span> ${item.ano}</td>
            <td class="numeric">R$ ${formatCurrency(item.total)}</td>
          </tr>
        `;
        item.meses.sort((a,b) => a.mes - b.mes).forEach(m => {
          htmlARec += `
            <tr class="sub-arec-${ano}" style="display:none; background: #ffffff;">
              <td style="padding-left: 32px; color: var(--gray-600);">${MESES_NOME[m.mes] || m.mes}</td>
              <td class="numeric">R$ ${formatCurrency(m.valor)}</td>
            </tr>
          `;
        });
      });

      tbodyAReceber.innerHTML = htmlARec;
      document.getElementById('acomp-total-a-receber').textContent = `R$ ${formatCurrency(areal)}`;
    }

    // 5. Tabela Contratos Assinados
    const tbodyContratos = document.getElementById('tbody-contratos-assinados');
    const contratos = data.contratos_assinados || [];

    if (!tbodyContratos) {
      // elemento pode nao existir em versoes anteriores
    } else if (!contratos.length) {
      tbodyContratos.innerHTML = '<tr><td colspan="3" style="text-align:center;">Nenhum contrato assinado.</td></tr>';
    } else {
      const porAnoContratos = {};
      let totalContratosGeral = 0;
      contratos.forEach(r => {
        const a = r.ano;
        if (!porAnoContratos[a]) porAnoContratos[a] = { ano: a, valorAno: 0, acumuladoMax: 0, meses: [] };
        const val = parseFloat(r.valor_mes || 0);
        const acum = parseFloat(r.valor_acumulado || 0);
        porAnoContratos[a].valorAno += val;
        porAnoContratos[a].acumuladoMax = acum;
        porAnoContratos[a].meses.push(r);
        totalContratosGeral += val;
      });

      let htmlContratos = '';
      const anosKeys = Object.keys(porAnoContratos).sort();
      let ultimoAcumulado = 0;

      anosKeys.forEach(ano => {
        const item = porAnoContratos[ano];
        ultimoAcumulado = item.acumuladoMax;
        htmlContratos += `
          <tr class="row-group" onclick="this.classList.toggle('expanded'); document.querySelectorAll('.sub-contrato-${ano}').forEach(el => el.style.display = el.style.display === 'none' ? 'table-row' : 'none');" style="cursor:pointer; font-weight:600; background: var(--gray-50);">
            <td><span style="display:inline-block; width:16px;">▶</span> ${item.ano}</td>
            <td class="numeric">R$ ${formatCurrency(item.valorAno)}</td>
            <td class="numeric">R$ ${formatCurrency(item.acumuladoMax)}</td>
          </tr>
        `;
        item.meses.sort((a,b) => a.mes - b.mes).forEach(m => {
          htmlContratos += `
            <tr class="sub-contrato-${ano}" style="display:none; background: #ffffff;">
              <td style="padding-left: 32px; color: var(--gray-600);">${MESES_NOME[m.mes] || m.mes}</td>
              <td class="numeric">R$ ${formatCurrency(m.valor_mes)}</td>
              <td class="numeric" style="color: var(--gray-600);">R$ ${formatCurrency(m.valor_acumulado)}</td>
            </tr>
          `;
        });
      });

      tbodyContratos.innerHTML = htmlContratos;
      document.getElementById('acomp-total-contratos').textContent = `R$ ${formatCurrency(totalContratosGeral)}`;
      document.getElementById('acomp-total-contratos-acumulado').textContent = `R$ ${formatCurrency(ultimoAcumulado)}`;
    }

  } catch (err) {
    console.error('Erro em renderTelaAcompanhamento:', err);
  }
}

// ── Inicialização ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  // Grafismo do header
  const headerNet = document.getElementById('header-net');
  if (headerNet) makeField(headerNet, { w: 1200, h: 300, n: 30, color: '#3A5AA0', red: '#E30A12', dist: 150, lineOp: 0.3, dotOp: 0.5 });

  const headerNetAcomp = document.getElementById('header-net-acomp');
  if (headerNetAcomp) makeField(headerNetAcomp, { w: 1200, h: 300, n: 30, color: '#3A5AA0', red: '#E30A12', dist: 150, lineOp: 0.3, dotOp: 0.5 });

  // Navegação sidebar
  document.querySelectorAll('.sidebar__nav a').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('.sidebar__nav a').forEach(l => l.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      link.classList.add('active');
      const targetPage = document.getElementById(`page-${link.dataset.page}`);
      targetPage?.classList.add('active');

      if (link.dataset.page === 'acompanhamento') {
        renderTelaAcompanhamento();
      }
    });
  });

  // Carrega dimensões (dropdowns) da API
  try {
    const res = await fetch(`${API}/dimensoes`);
    const dimensoes = await res.json();
    state.dimensoes = dimensoes;
    populateFilters(dimensoes);
  } catch (err) {
    console.error('Erro ao carregar dimensoes:', err);
  }

  // Carrega tabela inicial (sem filtros)
  await fetchAndRender();

  // Carrega os indicadores complementares
  await Promise.all([
    fetch2026Kpis(),
    renderChartInvestidoPorAno(),
    renderAcompanhamento(),
  ]);

  // Event listeners nos filtros da Gestão à Vista
  ['filter-empreendimento', 'filter-investidor', 'filter-lancado',
   'filter-tipo', 'filter-intermediador'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', fetchAndRender);
  });

  // Event listeners nos filtros do Acompanhamento
  ['acomp-filter-investidor', 'acomp-filter-empreendimento'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderTelaAcompanhamento);
  });

});

