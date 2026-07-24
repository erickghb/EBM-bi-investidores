"""
api.py
------
API backend que serve os dados do Neon para o frontend web.
Usa Flask (leve, sem necessidade de Node.js).

Uso:
  python api.py

Endpoints disponíveis:
  GET /api/dimensoes         → listas para os dropdowns (empreendimentos + investidores)
  GET /api/controle          → dados da tela Gestão à Vista (com filtros opcionais)
  GET /api/aniversarios      → dados da tela Aniversários

Filtros aceitos em /api/controle (query params):
  ?empreendimento=GY-1657 - LOC Serrinha
  ?investidor=LEONARDO OTTONI VIEIRA
  ?lancado=Sim
  ?tipo_investimento=SCP Investidor
  ?intermediador=N/A
"""

import os
import sys
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERRO: Execute: pip install flask flask-cors psycopg2-binary python-dotenv")
    sys.exit(1)

from pathlib import Path
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
DATABASE_URL = os.getenv("DATABASE_URL")

app = Flask(__name__)
CORS(app)  # Permite que o frontend (arquivo local) consuma a API


def get_conn():
    return psycopg2.connect(DATABASE_URL)


def query(sql, params=None):
    """Executa uma query e retorna lista de dicts."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


# ── Dimensões (Dropdowns) ────────────────────────
@app.route("/api/dimensoes", methods=["GET"])
def dimensoes():
    empreendimentos = query("""
        SELECT titulo, nome, status, cidade, apl_empreendimento
        FROM analytics.v_dim_empreendimentos
        ORDER BY nome
    """)
    investidores = query("""
        SELECT nome_investidor, data_nascimento, aniversario, data_aniversario_2026
        FROM analytics.v_dim_investidores
        ORDER BY nome_investidor
    """)
    tipos = query("""
        SELECT DISTINCT tipo_scp AS tipo_investimento
        FROM raw.gestao_investidores
        WHERE tipo_scp IS NOT NULL AND tipo_scp <> ''
        ORDER BY tipo_scp
    """)
    intermediadores = query("""
        SELECT DISTINCT nome_intermediador AS intermediador
        FROM raw.gestao_investidores
        WHERE nome_intermediador IS NOT NULL AND nome_intermediador <> ''
        ORDER BY nome_intermediador
    """)
    return jsonify({
        "empreendimentos": empreendimentos,
        "investidores": investidores,
        "tipos_investimento": [r["tipo_investimento"] for r in tipos],
        "intermediadores": [r["intermediador"] for r in intermediadores]
    })


# ── Tela Gestão à Vista ──────────────────────────
@app.route("/api/controle", methods=["GET"])
def controle_investidores():
    # Filtros via query string
    emp   = request.args.get("empreendimento")
    inv   = request.args.get("investidor")
    lan   = request.args.get("lancado")
    tipo  = request.args.get("tipo_investimento")
    inter = request.args.get("intermediador")

    where_clauses = ["1=1"]
    params = []

    if emp:
        where_clauses.append("nome_empreendimento = %s")
        params.append(emp)
    if inv:
        where_clauses.append("nome_investidor = %s")
        params.append(inv)
    if lan:
        where_clauses.append("empreendimento_lancado ILIKE %s")
        params.append(lan)
    if tipo:
        where_clauses.append("tipo_investimento = %s")
        params.append(tipo)
    if inter:
        where_clauses.append("intermediador = %s")
        params.append(inter)

    where = " AND ".join(where_clauses)

    rows = query(f"""
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
            obra_id,
            centro_custo
        FROM analytics.v_controle_investidores
        WHERE {where}
        ORDER BY nome_empreendimento, nome_investidor
    """, params if params else None)

    # KPIs agregados
    kpis = query(f"""
        SELECT
            COALESCE(SUM(valor_investido), 0)   AS total_investido,
            COALESCE(SUM(apl_investidor), 0)    AS total_apl,
            COUNT(*)                             AS qtd_registros
        FROM analytics.v_controle_investidores
        WHERE {where}
    """, params if params else None)

    return jsonify({
        "kpis": kpis[0] if kpis else {},
        "records": rows
    })


# ── Tela Aniversários ────────────────────────────
@app.route("/api/aniversarios", methods=["GET"])
def aniversarios():
    rows = query("""
        SELECT
            nome_investidor,
            data_nascimento,
            aniversario,
            data_aniversario_2026,
            contato,
            endereco
        FROM analytics.v_dim_investidores
        WHERE data_aniversario_2026 IS NOT NULL AND data_aniversario_2026 <> ''
        ORDER BY data_aniversario_2026
    """)
    return jsonify(rows)


# ── Gráfico 1: Valor Investido por Ano ───────────
# Fonte: data_assinatura ("janeiro de 2025") + valor_investido
# Extrai o ano com REGEXP e agrupa
@app.route("/api/grafico/investido-por-ano", methods=["GET"])
def investido_por_ano():
    rows = query("""
        SELECT
            SUBSTRING(data_assinatura FROM '[0-9]{4}') AS ano,
            SUM(COALESCE(valor_investido, 0))           AS total_investido,
            COUNT(*)                                     AS qtd_investidores
        FROM raw.gestao_investidores
        WHERE data_assinatura IS NOT NULL
          AND data_assinatura ~ '[0-9]{4}'
          AND COALESCE(ativo_inativo, '') <> 'Inativo'
        GROUP BY ano
        ORDER BY ano
    """)
    # Soma total para referência
    total = sum(float(r["total_investido"] or 0) for r in rows)
    return jsonify({"por_ano": rows, "total": total})


# ── Tabela 2: Acompanhamento de Empreendimentos ───
# Fonte: gestao_investidores (tolerâncias, penalidades) + landbank (datas, nome)
@app.route("/api/grafico/acompanhamento", methods=["GET"])
def acompanhamento_empreendimentos():
    rows = query("""
        SELECT DISTINCT ON (lb.titulo)
            lb.nome                              AS nome_empreendimento,
            lb.titulo                            AS titulo,
            gi.data_lancamento_tolerancia,
            lb.data_lancamento                   AS data_previsao_lancamento,
            gi.data_conclusao_tolerancia,
            gi.penalidade_lancamento,
            gi.penalidade_conclusao,
            gi.plano_de_acao,
            gi.nome_intermediador                AS intermediador,
            COUNT(gi.id) OVER (
                PARTITION BY lb.titulo
            )                                    AS qtd_investidores
        FROM raw.gestao_investidores gi
        INNER JOIN raw.landbank lb
            ON gi.obra_id = lb.titulo
            OR gi.centro_custo = lb.titulo
        WHERE lb.nome IS NOT NULL AND lb.nome <> ''
          AND COALESCE(gi.ativo_inativo, '') <> 'Inativo'
        ORDER BY lb.titulo, gi.data_lancamento_tolerancia NULLS LAST
    """)
    return jsonify(rows)


# ── Health check ─────────────────────────────────
@app.route("/api/status", methods=["GET"])
def status():
    return jsonify({"status": "ok", "database": "neon"})


if __name__ == "__main__":
    if not DATABASE_URL:
        print("ERRO: DATABASE_URL não encontrada. Verifique o arquivo .env")
        sys.exit(1)
    print("API rodando em http://localhost:5000")
    app.run(debug=True, port=5000)
