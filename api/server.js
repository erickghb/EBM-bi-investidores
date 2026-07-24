/**
 * server.js — EBM Inteligência: API Backend (Node.js / Express)
 * Substitui o api.py (Flask) sem precisar de permissão de porta do Windows.
 *
 * Uso:
 *   node api/server.js
 *
 * Endpoints:
 *   GET /api/status
 *   GET /api/dimensoes
 *   GET /api/controle          (query: empreendimento, investidor, lancado, tipo_investimento, intermediador)
 *   GET /api/aniversarios
 *   GET /api/grafico/investido-por-ano
 *   GET /api/grafico/acompanhamento
 */

const express = require('express');
const cors    = require('cors');
const { Pool } = require('pg');
const path    = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app  = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// ── Conexão com o Neon ───────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Helper: roda uma query e retorna rows como array de objetos
async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    client.release();
  }
}

// ── Health Check ─────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  res.json({ status: 'ok', database: 'neon', runtime: 'node' });
});

// ── Dimensões (dropdowns) ────────────────────────────────────────
app.get('/api/dimensoes', async (req, res) => {
  try {
    const [empreendimentos, investidores, tipos, intermediadores] = await Promise.all([
      query(`SELECT titulo, nome FROM analytics.v_dim_empreendimentos ORDER BY nome`),
      query(`SELECT nome_investidor FROM analytics.v_dim_investidores ORDER BY nome_investidor`),
      query(`SELECT DISTINCT tipo_scp AS tipo FROM raw.gestao_investidores
             WHERE tipo_scp IS NOT NULL AND tipo_scp <> '' ORDER BY tipo`),
      query(`SELECT DISTINCT nome_intermediador AS intermediador FROM raw.gestao_investidores
             WHERE nome_intermediador IS NOT NULL AND nome_intermediador <> ''
             ORDER BY nome_intermediador`),
    ]);

    res.json({
      empreendimentos,
      investidores,
      tipos_investimento: tipos.map(r => r.tipo),
      intermediadores:    intermediadores.map(r => r.intermediador),
    });
  } catch (err) {
    console.error('/api/dimensoes error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Controle de Investidores ─────────────────────────────────────
app.get('/api/controle', async (req, res) => {
  try {
    const { empreendimento, investidor, lancado, tipo_investimento, intermediador } = req.query;
    const conditions = [];
    const params     = [];

    if (empreendimento)    { params.push(empreendimento);    conditions.push(`nome_empreendimento = $${params.length}`); }
    if (investidor)        { params.push(investidor);        conditions.push(`nome_investidor = $${params.length}`); }
    if (lancado)           { params.push(lancado);           conditions.push(`empreendimento_lancado = $${params.length}`); }
    if (tipo_investimento) { params.push(tipo_investimento); conditions.push(`tipo_investimento = $${params.length}`); }
    if (intermediador)     { params.push(intermediador);     conditions.push(`intermediador = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const records = await query(`
      SELECT
        nome_empreendimento,
        nome_investidor,
        empreendimento_lancado,
        tipo_investimento,
        intermediador,
        data_assinatura,
        valor_investido,
        apl_investidor,
        apl_empreendimento,
        perc_apl_comprometida,
        status,
        plano_de_acao,
        status_acerto,
        data_lancamento_tolerancia,
        data_conclusao_tolerancia,
        obra_id
      FROM analytics.v_controle_investidores
      ${where}
      ORDER BY nome_empreendimento, nome_investidor
    `, params);

    // KPIs
    const total_investido = records.reduce((s, r) => s + parseFloat(r.valor_investido || 0), 0);
    const total_apl       = records.reduce((s, r) => s + parseFloat(r.apl_investidor  || 0), 0);

    res.json({ records, kpis: { total_investido, total_apl, qtd_registros: records.length } });
  } catch (err) {
    console.error('/api/controle error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Aniversários ─────────────────────────────────────────────────
app.get('/api/aniversarios', async (req, res) => {
  try {
    const rows = await query(`
      SELECT nome_investidor, data_nascimento, aniversario,
             data_aniversario_2026, contato, endereco
      FROM analytics.v_dim_investidores
      WHERE data_aniversario_2026 IS NOT NULL AND data_aniversario_2026 <> ''
      ORDER BY data_aniversario_2026
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Gráfico 1: Valor Investido por Ano ───────────────────────────
app.get('/api/grafico/investido-por-ano', async (req, res) => {
  try {
    const rows = await query(`
      SELECT
        SUBSTRING(data_assinatura FROM '[0-9]{4}') AS ano,
        SUM(COALESCE(valor_investido, 0))          AS total_investido,
        COUNT(*)                                    AS qtd_investidores
      FROM raw.gestao_investidores
      WHERE data_assinatura IS NOT NULL
        AND data_assinatura ~ '[0-9]{4}'
        AND COALESCE(ativo_inativo, '') <> 'Inativo'
      GROUP BY ano
      ORDER BY ano
    `);
    const total = rows.reduce((s, r) => s + parseFloat(r.total_investido || 0), 0);
    res.json({ por_ano: rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Gráfico 2: Acompanhamento de Empreendimentos ─────────────────
app.get('/api/grafico/acompanhamento', async (req, res) => {
  try {
    const rows = await query(`
      SELECT DISTINCT ON (lb.titulo)
        lb.nome                            AS nome_empreendimento,
        lb.titulo,
        gi.data_lancamento_tolerancia,
        lb.data_lancamento                 AS data_previsao_lancamento,
        gi.data_conclusao_tolerancia,
        gi.penalidade_lancamento,
        gi.penalidade_conclusao,
        gi.plano_de_acao,
        gi.nome_intermediador              AS intermediador,
        COUNT(gi.id) OVER (PARTITION BY lb.titulo) AS qtd_investidores
      FROM raw.gestao_investidores gi
      INNER JOIN raw.landbank lb
        ON gi.obra_id = lb.titulo OR gi.centro_custo = lb.titulo
      WHERE lb.nome IS NOT NULL AND lb.nome <> ''
        AND COALESCE(gi.ativo_inativo, '') <> 'Inativo'
      ORDER BY lb.titulo, gi.data_lancamento_tolerancia NULLS LAST
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Tela Acompanhamento $ ─────────────────────────────────────────
// Receita acumulada equivalente ao DAX:
// CALCULATE(SUM(Realizado), FILTER(ALL(Fluxo), Data <= MAX(Data)))
app.get('/api/acompanhamento/receita', async (req, res) => {
  try {
    const { empreendimento, investidor } = req.query;
    const baseConditions = [
      "data_pagamento IS NOT NULL",
      "status NOT IN ('DEVOLVIDO C/CORRECAO', 'DEVOLVIDO C/CORREÇÃO')"
    ];
    const params = [];

    if (empreendimento) { params.push(empreendimento); baseConditions.push(`empreendimento ILIKE $${params.length}`); }
    if (investidor)     { params.push(investidor);     baseConditions.push(`investidor ILIKE $${params.length}`); }
    const where = baseConditions.map(c => `(${c})`).join(' AND ');

    // Mensal com acumulado — window function equivalente ao DAX CALCULATE/FILTER/ALL
    const mensal = await query(`
      WITH mensal AS (
        SELECT
          EXTRACT(YEAR  FROM data_pagamento)::INT AS ano,
          EXTRACT(MONTH FROM data_pagamento)::INT AS mes,
          SUM(COALESCE(realizado, 0))             AS receita_mes,
          SUM(COALESCE(a_realizar, 0))            AS a_realizar_mes
        FROM raw.fluxo_entrada
        WHERE ${where}
        GROUP BY 1, 2
      )
      SELECT ano, mes, receita_mes, a_realizar_mes,
        SUM(receita_mes) OVER (ORDER BY ano, mes ROWS UNBOUNDED PRECEDING) AS receita_acumulada
      FROM mensal
      ORDER BY ano, mes
    `, params);

    // KPIs totais
    const kpis = await query(`
      SELECT
        SUM(COALESCE(realizado, 0))  AS total_realizado,
        SUM(COALESCE(a_realizar, 0)) AS total_a_realizar
      FROM raw.fluxo_entrada WHERE ${where}
    `, params);

    // Parcelas a receber futuras
    const a_receber = await query(`
      SELECT
        EXTRACT(YEAR  FROM data_pagamento)::INT AS ano,
        EXTRACT(MONTH FROM data_pagamento)::INT AS mes,
        SUM(COALESCE(a_realizar, 0))            AS valor
      FROM raw.fluxo_entrada
      WHERE ${where} AND a_realizar > 0
      GROUP BY 1, 2 ORDER BY 1, 2
    `, params);

    // Contratos Assinados (da tabela raw.apl_vlr_contrato)
    const contratosConditions = [
      "data_assinatura IS NOT NULL",
      "status NOT IN ('DEVOLVIDO C/CORRECAO', 'DEVOLVIDO C/CORREÇÃO')"
    ];
    const cParams = [];
    if (empreendimento) { cParams.push(empreendimento); contratosConditions.push(`empreendimento ILIKE $${cParams.length}`); }
    if (investidor)     { cParams.push(investidor);     contratosConditions.push(`investidor ILIKE $${cParams.length}`); }
    const cWhere = contratosConditions.map(c => `(${c})`).join(' AND ');

    const contratos_assinados = await query(`
      WITH mensal AS (
        SELECT
          EXTRACT(YEAR  FROM data_assinatura)::INT AS ano,
          EXTRACT(MONTH FROM data_assinatura)::INT AS mes,
          SUM(COALESCE(valor_contrato, 0))        AS valor_mes
        FROM raw.apl_vlr_contrato
        WHERE ${cWhere}
        GROUP BY 1, 2
      )
      SELECT ano, mes, valor_mes,
        SUM(valor_mes) OVER (ORDER BY ano, mes ROWS UNBOUNDED PRECEDING) AS valor_acumulado
      FROM mensal
      ORDER BY ano, mes
    `, cParams);

    // Dropdowns desta tela
    const emps = await query(`SELECT DISTINCT empreendimento FROM raw.fluxo_entrada WHERE empreendimento IS NOT NULL ORDER BY empreendimento`);
    const invs = await query(`SELECT DISTINCT investidor FROM raw.fluxo_entrada WHERE investidor IS NOT NULL ORDER BY investidor`);

    const mensalParsed = mensal.map(r => ({
      ano: r.ano,
      mes: r.mes,
      receita_mes: parseFloat(r.receita_mes || 0),
      a_realizar_mes: parseFloat(r.a_realizar_mes || 0),
      receita_acumulada: parseFloat(r.receita_acumulada || 0)
    }));

    const aReceberParsed = a_receber.map(r => ({
      ano: r.ano,
      mes: r.mes,
      valor: parseFloat(r.valor || 0)
    }));

    const contratosParsed = contratos_assinados.map(r => ({
      ano: r.ano,
      mes: r.mes,
      valor_mes: parseFloat(r.valor_mes || 0),
      valor_acumulado: parseFloat(r.valor_acumulado || 0)
    }));

    res.json({
      mensal: mensalParsed,
      a_receber: aReceberParsed,
      contratos_assinados: contratosParsed,
      kpis: {
        total_realizado: parseFloat(kpis[0]?.total_realizado || 0),
        total_a_realizar: parseFloat(kpis[0]?.total_a_realizar || 0),
      },
      dimensoes: {
        empreendimentos: emps.map(r => r.empreendimento),
        investidores:    invs.map(r => r.investidor),
      }
    });
  } catch (err) {
    console.error('/api/acompanhamento/receita:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── KPIs 2026 ────────────────────────────────────────────────────
// Investimentos em 2026: soma de valor_investido com data_assinatura contendo '2026'
// Meta 2026: valor fixo de negócio (20 Mi — conforme definido no PBIX)
app.get('/api/kpis/2026', async (req, res) => {
  try {
    const rows = await query(`
      SELECT
        SUM(COALESCE(valor_investido, 0)) AS investido_2026
      FROM raw.gestao_investidores
      WHERE data_assinatura ILIKE '%2026%'
        AND COALESCE(ativo_inativo, '') <> 'Inativo'
    `);
    const investido_2026 = parseFloat(rows[0]?.investido_2026 || 0);
    const meta_2026      = 20_000_000; // Meta definida pela EBM
    const perc_atingido  = meta_2026 > 0 ? (investido_2026 / meta_2026) * 100 : 0;

    res.json({
      investido_2026,
      meta_2026,
      perc_atingido: parseFloat(perc_atingido.toFixed(1)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
  console.log('Endpoints disponíveis:');
  console.log('  GET /api/status');
  console.log('  GET /api/dimensoes');
  console.log('  GET /api/controle');
  console.log('  GET /api/aniversarios');
  console.log('  GET /api/grafico/investido-por-ano');
  console.log('  GET /api/grafico/acompanhamento');
  console.log('  GET /api/kpis/2026');
});

