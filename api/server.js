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

    const periodos = await query(`
      SELECT DISTINCT SUBSTRING(data_assinatura FROM '[0-9]{4}') AS ano
      FROM raw.gestao_investidores
      WHERE data_assinatura IS NOT NULL AND data_assinatura ~ '[0-9]{4}'
      ORDER BY ano DESC
    `);

    res.json({
      empreendimentos: empreendimentos.map(r => (typeof r === 'string' ? r : (r.nome || r.titulo || ''))).filter(Boolean),
      investidores:    investidores.map(r => (typeof r === 'string' ? r : (r.nome_investidor || ''))).filter(Boolean),
      tipos_investimento: tipos.map(r => r.tipo).filter(Boolean),
      intermediadores:    intermediadores.map(r => r.intermediador).filter(Boolean),
      empreendimento_lancado: ["Sim", "Não"],
      periodos: periodos.map(r => r.ano).filter(Boolean)
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

    const defaultWhere = `WHERE
      (tipo_investimento IS NULL OR UPPER(tipo_investimento) NOT LIKE '%ACERTO%')
      AND (status IS NULL OR UPPER(status) NOT LIKE '%ACERTO%')
      AND (status_acerto IS NULL OR UPPER(status_acerto) NOT LIKE '%ACERTO%')
      AND UPPER(COALESCE(status, '')) NOT LIKE '%DISTRAT%'`;
    const where = conditions.length ? `${defaultWhere} AND ${conditions.join(' AND ')}` : defaultWhere;

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

    const parsedRecords = records.map(r => ({
      ...r,
      valor_investido: parseFloat(r.valor_investido || 0),
      apl_investidor: parseFloat(r.apl_investidor || 0),
      apl_empreendimento: parseFloat(r.apl_empreendimento || 0),
      perc_apl_comprometida: parseFloat(r.perc_apl_comprometida || 0)
    }));

    // Agrupa por empreendimento para facilitar a renderização no frontend
    const empMap = {};
    parsedRecords.forEach(r => {
      const emp = r.nome_empreendimento || 'Outros';
      if (!empMap[emp]) {
        empMap[emp] = {
          nome_empreendimento: emp,
          total_investido: 0,
          apl_empreendimento: r.apl_empreendimento || 0,
          investidores: []
        };
      }
      empMap[emp].total_investido += r.valor_investido;
      empMap[emp].investidores.push(r);
    });

    const empreendimentos = Object.values(empMap).map(e => ({
      ...e,
      total_investido: parseFloat(e.total_investido.toFixed(2)),
      qtd_investidores: e.investidores.length
    }));

    // KPIs
    const total_investido = parsedRecords.reduce((s, r) => s + r.valor_investido, 0);
    const total_apl       = parsedRecords.reduce((s, r) => s + r.apl_investidor, 0);

    res.json({
      records: parsedRecords,
      empreendimentos,
      kpis: {
        total_investido: parseFloat(total_investido.toFixed(2)),
        total_apl: parseFloat(total_apl.toFixed(2)),
        qtd_registros: parsedRecords.length
      }
    });
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
        AND (tipo_scp IS NULL OR UPPER(tipo_scp) NOT LIKE '%ACERTO%')
        AND UPPER(COALESCE(status, '')) NOT LIKE '%DISTRAT%'
      GROUP BY ano
      ORDER BY ano
    `);
    const parsedRows = rows.map(r => ({
      ano: r.ano,
      total_investido: parseFloat(parseFloat(r.total_investido || 0).toFixed(2)),
      qtd_investidores: parseInt(r.qtd_investidores || 0, 10)
    }));
    const total = parsedRows.reduce((s, r) => s + r.total_investido, 0);
    res.json({ por_ano: parsedRows, total: parseFloat(total.toFixed(2)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Gráfico 2: Acompanhamento de Empreendimentos ─────────────────
// Regras de negócio estritas:
//   1. Distratados excluídos (UPPER(status) NOT LIKE '%DISTRAT%')
//   2. Data de lançamento com tolerância = gi.data_lancamento_tolerancia (Gestão de Investidores)
//   3. Previsão de Lançamento = COALESCE(lb.data_lancamento, gi.data_lancamento)
//   4. Previsão de Conclusão = Lançamento + lb.tempo_obras_meses (Landbank)
//      Fórmula DAX equivalente: EOMONTH(DataOriginal, Meses-1) + DAY(DataOriginal)
app.get('/api/grafico/acompanhamento', async (req, res) => {
  try {
    const rows = await query(`
      SELECT
        lb.nome                                   AS nome_empreendimento,
        gi.nome_investidor,
        CASE
          WHEN gi.data_lancamento_tolerancia ~ '^\\d{4}-\\d{2}-\\d{2}' THEN gi.data_lancamento_tolerancia
          WHEN gi.data_lancamento_tolerancia ~ '^\\d{2}/\\d{2}/\\d{4}' THEN TO_CHAR(TO_DATE(gi.data_lancamento_tolerancia, 'DD/MM/YYYY'), 'YYYY-MM-DD')
          ELSE gi.data_lancamento_tolerancia
        END                                       AS data_lancamento_tolerancia,

        COALESCE(
          CASE
            WHEN lb.data_lancamento ~ '^\\d{4}-\\d{2}-\\d{2}' THEN lb.data_lancamento
            WHEN lb.data_lancamento ~ '^\\d{2}/\\d{2}/\\d{4}' THEN TO_CHAR(TO_DATE(lb.data_lancamento, 'DD/MM/YYYY'), 'YYYY-MM-DD')
            ELSE NULL
          END,
          CASE
            WHEN gi.data_lancamento ~ '^\\d{4}-\\d{2}-\\d{2}' THEN gi.data_lancamento
            WHEN gi.data_lancamento ~ '^\\d{2}/\\d{2}/\\d{4}' THEN TO_CHAR(TO_DATE(gi.data_lancamento, 'DD/MM/YYYY'), 'YYYY-MM-DD')
            WHEN gi.data_lancamento IS NOT NULL AND gi.data_lancamento <> '' THEN gi.data_lancamento
            ELSE NULL
          END
        )                                         AS data_previsao_lancamento,

        gi.penalidade_lancamento,

        CASE
          WHEN gi.data_conclusao_tolerancia ~ '^\\d{4}-\\d{2}-\\d{2}' THEN gi.data_conclusao_tolerancia
          WHEN gi.data_conclusao_tolerancia ~ '^\\d{2}/\\d{2}/\\d{4}' THEN TO_CHAR(TO_DATE(gi.data_conclusao_tolerancia, 'DD/MM/YYYY'), 'YYYY-MM-DD')
          ELSE gi.data_conclusao_tolerancia
        END                                       AS data_conclusao_tolerancia,

        CASE
          WHEN COALESCE(
            CASE
              WHEN lb.data_lancamento ~ '^\\d{4}-\\d{2}-\\d{2}' THEN lb.data_lancamento::date
              WHEN lb.data_lancamento ~ '^\\d{2}/\\d{2}/\\d{4}' THEN TO_DATE(lb.data_lancamento, 'DD/MM/YYYY')
              ELSE NULL
            END,
            CASE
              WHEN gi.data_lancamento ~ '^\\d{4}-\\d{2}-\\d{2}' THEN gi.data_lancamento::date
              WHEN gi.data_lancamento ~ '^\\d{2}/\\d{2}/\\d{4}' THEN TO_DATE(gi.data_lancamento, 'DD/MM/YYYY')
              ELSE NULL
            END
          ) IS NOT NULL
          AND lb.tempo_obras_meses IS NOT NULL
          AND lb.tempo_obras_meses ~ '^[0-9]+(\\.[0-9]+)?$'
          THEN TO_CHAR(
            (
              COALESCE(
                CASE
                  WHEN lb.data_lancamento ~ '^\\d{4}-\\d{2}-\\d{2}' THEN lb.data_lancamento::date
                  WHEN lb.data_lancamento ~ '^\\d{2}/\\d{2}/\\d{4}' THEN TO_DATE(lb.data_lancamento, 'DD/MM/YYYY')
                  ELSE NULL
                END,
                CASE
                  WHEN gi.data_lancamento ~ '^\\d{4}-\\d{2}-\\d{2}' THEN gi.data_lancamento::date
                  WHEN gi.data_lancamento ~ '^\\d{2}/\\d{2}/\\d{4}' THEN TO_DATE(gi.data_lancamento, 'DD/MM/YYYY')
                  ELSE NULL
                END
              ) + (ROUND(lb.tempo_obras_meses::numeric)::int || ' months')::interval
            )::date,
            'YYYY-MM-DD'
          )
          WHEN gi.data_conclusao ~ '^\\d{4}-\\d{2}-\\d{2}' THEN gi.data_conclusao
          WHEN gi.data_conclusao ~ '^\\d{2}/\\d{2}/\\d{4}' THEN TO_CHAR(TO_DATE(gi.data_conclusao, 'DD/MM/YYYY'), 'YYYY-MM-DD')
          ELSE NULL
        END                                       AS data_previsao_conclusao,

        gi.penalidade_conclusao,
        gi.plano_de_acao,
        gi.nome_intermediador                     AS intermediador
      FROM raw.gestao_investidores gi
      JOIN raw.landbank lb
        ON gi.obra_id::text = lb.titulo::text OR gi.centro_custo::text = lb.titulo::text
      WHERE COALESCE(gi.ativo_inativo, '') <> 'Inativo'
        AND UPPER(COALESCE(gi.status, '')) NOT LIKE '%DISTRAT%'
        AND (gi.tipo_scp IS NULL OR UPPER(gi.tipo_scp) NOT LIKE '%ACERTO%')
        AND (
          lb.nome ILIKE '%Palmeiras%'
          OR lb.nome ILIKE '%Mansões%'
          OR lb.nome ILIKE '%Cambuí%'
          OR lb.nome ILIKE '%Alpes%'
          OR lb.nome ILIKE '%J19%'
          OR lb.nome ILIKE '%Gran Plaza%'
          OR lb.nome ILIKE '%Metropolitan Marista%'
          OR lb.nome ILIKE '%Ipê%'
          OR lb.nome ILIKE '%106%'
          OR lb.nome ILIKE '%Gran%'
        )
      ORDER BY lb.nome, gi.nome_investidor
    `);

    const empMap = {};
    (rows || []).forEach(r => {
      const emp = r.nome_empreendimento || 'Outros';
      if (!empMap[emp]) {
        empMap[emp] = {
          nome_empreendimento: emp,
          data_previsao_lancamento:  r.data_previsao_lancamento  || '-',
          data_previsao_conclusao:   r.data_previsao_conclusao   || '-',
          data_lancamento_tolerancia: r.data_lancamento_tolerancia || '-',
          data_conclusao_tolerancia:  r.data_conclusao_tolerancia  || '-',
          penalidade_lancamento: r.penalidade_lancamento || '-',
          penalidade_conclusao:  r.penalidade_conclusao  || '-',
          plano_de_acao: r.plano_de_acao || '-',
          intermediador: r.intermediador || '-',
          investidores: []
        };
      }

      // Se o empreendimento pai ainda não tinha a data de lançamento/conclusão e este registro encontrou:
      if ((!empMap[emp].data_previsao_lancamento || empMap[emp].data_previsao_lancamento === '-') && r.data_previsao_lancamento) {
        empMap[emp].data_previsao_lancamento = r.data_previsao_lancamento;
      }
      if ((!empMap[emp].data_previsao_conclusao || empMap[emp].data_previsao_conclusao === '-') && r.data_previsao_conclusao) {
        empMap[emp].data_previsao_conclusao = r.data_previsao_conclusao;
      }

      empMap[emp].investidores.push({
        nome_investidor:              r.nome_investidor             || 'Investidor',
        data_lancamento_tolerancia:   r.data_lancamento_tolerancia  || '-',
        data_previsao_lancamento:     r.data_previsao_lancamento || empMap[emp].data_previsao_lancamento || '-',
        penalidade_lancamento:        r.penalidade_lancamento       || '-',
        data_conclusao_tolerancia:    r.data_conclusao_tolerancia   || '-',
        data_previsao_conclusao:      r.data_previsao_conclusao || empMap[emp].data_previsao_conclusao || '-',
        penalidade_conclusao:         r.penalidade_conclusao        || '-',
        plano_de_acao:                r.plano_de_acao               || '-',
        intermediador:                r.intermediador               || '-'
      });
    });

    const empreendimentos = Object.values(empMap).map(e => ({
      ...e,
      qtd_investidores: e.investidores.length
    }));

    res.json(empreendimentos);
  } catch (err) {
    console.error('/api/grafico/acompanhamento error:', err.message);
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
          SUBSTRING(data_pagamento FROM 1 FOR 4)::INT AS ano,
          SUBSTRING(data_pagamento FROM 6 FOR 2)::INT AS mes,
          SUM(COALESCE(realizado, 0))                 AS receita_mes,
          SUM(COALESCE(previsto, 0))                  AS a_realizar_mes
        FROM raw.fluxo_entrada
        WHERE ${where} AND data_pagamento ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
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
        SUM(COALESCE(realizado, 0)) AS total_realizado,
        SUM(COALESCE(previsto, 0))  AS total_a_realizar
      FROM raw.fluxo_entrada WHERE ${where}
    `, params);

    // Parcelas a receber detalhadas por Empreendimento e Investidor (da tabela raw.fluxo_entrada)
    const a_receber_detalhado = await query(`
      SELECT
        id,
        COALESCE(empreendimento, 'Empreendimento') AS empreendimento,
        COALESCE(investidor, 'Investidor') AS investidor,
        data_pagamento,
        SUBSTRING(data_pagamento FROM 1 FOR 4)::INT AS ano,
        EXTRACT(MONTH FROM TO_DATE(data_pagamento, 'YYYY-MM-DD'))::INT AS mes_num,
        COALESCE(previsto, 0)::float AS previsto
      FROM raw.fluxo_entrada
      WHERE ${where} AND COALESCE(previsto, 0)::float > 0
        AND data_pagamento ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
      ORDER BY ano ASC, mes_num ASC, empreendimento, investidor
    `, params);

    // Contratos Assinados (da tabela raw.apl_valor_contrato)
    // Regra de negócio: contratos ativos com crédito do investidor (status VÁLIDO e MIGRADO).
    // Apenas contratos devolvidos (DEVOLVIDO C/CORREÇÃO) são excluídos.
    const contratos_detalhado = await query(`
      SELECT
        id,
        COALESCE(empreendimento, 'Empreendimento') AS empreendimento,
        COALESCE(investidor, 'Investidor') AS investidor,
        data_assinatura_contrato,
        SUBSTRING(data_assinatura_contrato FROM 1 FOR 4)::INT AS ano,
        EXTRACT(MONTH FROM TO_DATE(data_assinatura_contrato, 'YYYY-MM-DD'))::INT AS mes_num,
        TO_CHAR(TO_DATE(data_assinatura_contrato, 'YYYY-MM-DD'), 'Month') AS mes_name_raw,
        valor_contrato::float AS valor_contrato,
        COALESCE(status, 'VÁLIDO') AS status
      FROM raw.apl_valor_contrato
      WHERE valor_contrato IS NOT NULL AND valor_contrato::float > 0
        AND data_assinatura_contrato ~ '^(19|20)[0-9]{2}'
        AND UPPER(TRIM(COALESCE(status, ''))) NOT ILIKE '%DEVOLVIDO%'
      ORDER BY ano ASC, mes_num ASC, empreendimento, investidor
    `);

    // KPI Total bruto — todos os status (para "Soma de Valor do Contrato" como no BI de referência)
    const totalBrutoResult = await query(`
      SELECT ROUND(SUM(valor_contrato::float)::numeric, 2) AS total
      FROM raw.apl_valor_contrato
      WHERE valor_contrato IS NOT NULL AND valor_contrato::float > 0
        AND data_assinatura_contrato ~ '^(19|20)[0-9]{2}'
    `);

    // KPI Total válidos + migrados (crédito ativo do investidor)
    const totalValidoResult = await query(`
      SELECT ROUND(SUM(valor_contrato::float)::numeric, 2) AS total
      FROM raw.apl_valor_contrato
      WHERE valor_contrato IS NOT NULL AND valor_contrato::float > 0
        AND data_assinatura_contrato ~ '^(19|20)[0-9]{2}'
        AND UPPER(TRIM(COALESCE(status, ''))) NOT ILIKE '%DEVOLVIDO%'
    `);

    // Receita detalhada por Empreendimento e Investidor (da tabela raw.fluxo_entrada)
    const receita_detalhada = await query(`
      SELECT
        id,
        COALESCE(empreendimento, 'Empreendimento') AS empreendimento,
        COALESCE(investidor, 'Investidor') AS investidor,
        data_pagamento,
        SUBSTRING(data_pagamento FROM 1 FOR 4)::INT AS ano,
        EXTRACT(MONTH FROM TO_DATE(data_pagamento, 'YYYY-MM-DD'))::INT AS mes_num,
        realizado::float AS receita_mes
      FROM raw.fluxo_entrada
      WHERE ${where} AND data_pagamento ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND realizado::float > 0
      ORDER BY data_pagamento ASC, id ASC
    `, params);

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

    const aReceberParsed = (a_receber_detalhado || []).map(r => ({
      ano: r.ano,
      mes: r.mes_num,
      valor: parseFloat(r.previsto || 0)
    }));

    // Nomes dos meses em pt-BR (TO_CHAR do Postgres retorna em inglês — mapeamos aqui)
    const mesNomesPTBR = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    const aReceberDetalhadoParsed = (a_receber_detalhado || []).map(r => ({
      id: r.id,
      empreendimento: r.empreendimento,
      investidor: r.investidor,
      data_pagamento: r.data_pagamento,
      ano: r.ano,
      mes_num: r.mes_num || 1,
      mes_name: mesNomesPTBR[r.mes_num || 1] || 'Janeiro',
      previsto: parseFloat(r.previsto || 0)
    }));

    const receitaDetalhadaParsed = (receita_detalhada || []).map(r => ({
      id: r.id,
      empreendimento: r.empreendimento,
      investidor: r.investidor,
      data_pagamento: r.data_pagamento,
      ano: r.ano,
      mes_num: r.mes_num || 1,
      mes_name: mesNomesPTBR[r.mes_num || 1] || 'Janeiro',
      receita_mes: parseFloat(r.receita_mes || 0)
    }));

    const contratosParsed = (contratos_detalhado || []).map(r => ({
      id: r.id,
      empreendimento: r.empreendimento,
      investidor: r.investidor,
      data_assinatura: r.data_assinatura_contrato,
      ano: r.ano || 2024,
      mes_num: r.mes_num || 1,
      mes_name: mesNomesPTBR[r.mes_num || 1] || 'Janeiro',
      valor_contrato: parseFloat(r.valor_contrato || 0)
    }));

    res.json({
      mensal: mensalParsed,
      receita_detalhada: receitaDetalhadaParsed,
      a_receber: aReceberParsed,
      a_receber_detalhado: aReceberDetalhadoParsed,
      contratos_assinados: contratosParsed,
      kpis: {
        total_realizado: parseFloat(kpis[0]?.total_realizado || 0),
        total_a_realizar: parseFloat(kpis[0]?.total_a_realizar || 0),
        valor_contrato_total: parseFloat(totalBrutoResult[0]?.total || 0),
        valor_contrato_valido: parseFloat(totalValidoResult[0]?.total || 0),
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
        AND (tipo_scp IS NULL OR UPPER(tipo_scp) NOT LIKE '%ACERTO%')
        AND (observacoes IS NULL OR UPPER(observacoes) NOT LIKE '%ACERTO%')
        AND UPPER(COALESCE(status, '')) NOT LIKE '%DISTRAT%'
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

