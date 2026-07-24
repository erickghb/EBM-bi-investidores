"""
load_to_neon.py
---------------
Script de carga inicial dos CSVs exportados do PBIX para o Neon/PostgreSQL.

Uso:
  1. Copie .env.example para .env e preencha DATABASE_URL
  2. Execute:  python load_to_neon.py

O script é idempotente: pode ser re-executado semanalmente para atualizar os dados.
Ele trunca e recarrega as tabelas raw.* a cada execução.
"""

import csv
import os
import re
import sys
from pathlib import Path
from dotenv import load_dotenv

# ──────────────────────────────────────────────
# Dependências: psycopg2 e python-dotenv
# Se não instaladas: pip install psycopg2-binary python-dotenv
# ──────────────────────────────────────────────
try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("ERRO: psycopg2 não encontrado. Execute: pip install psycopg2-binary python-dotenv")
    sys.exit(1)

# ── Configuração ────────────────────────────────
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
DATABASE_URL = os.getenv("DATABASE_URL")
# Pasta data/ fica um nível acima de etl/
BASE_DIR = Path(__file__).resolve().parent.parent / "data"

if not DATABASE_URL:
    print("ERRO: DATABASE_URL não encontrada. Verifique o arquivo .env")
    sys.exit(1)


# ── Utilitários ─────────────────────────────────
def slug(text: str) -> str:
    """Converte nome de coluna para snake_case compatível com PostgreSQL."""
    text = str(text).strip()
    text = re.sub(r'[%\$@#!\?\(\)\[\]]', '', text)
    text = re.sub(r'[^a-zA-Z0-9_\u00C0-\u024F]', '_', text)
    text = re.sub(r'_+', '_', text).strip('_').lower()
    # Não pode começar com número
    if text and text[0].isdigit():
        text = 'col_' + text
    return text[:63]  # Limite do PostgreSQL


def read_csv(filepath: Path):
    """Lê CSV com encoding cp1252 (padrão Windows/Excel) e retorna headers + rows."""
    with open(filepath, mode='r', encoding='cp1252', errors='replace') as f:
        reader = csv.DictReader(f, delimiter=';')
        headers = reader.fieldnames or []
        rows = list(reader)
    return headers, rows


def clean_val(val):
    """Retorna None para strings vazias, caso contrário o valor limpo."""
    if val is None:
        return None
    v = str(val).strip()
    return None if v == '' else v


# ── Conexão ─────────────────────────────────────
def get_conn():
    return psycopg2.connect(DATABASE_URL)


# ── DDL: Criação de Schemas e Tabelas ────────────
DDL = """
-- Schema raw: espelho fiel das exportações
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS analytics;

-- ─────────────────────────────
-- raw.landbank
-- Fonte: LANDBANK.csv
-- Dimensão de empreendimentos
-- ─────────────────────────────
CREATE TABLE IF NOT EXISTS raw.landbank (
    id                          SERIAL PRIMARY KEY,
    titulo                      TEXT,           -- Centro de Custo (chave de join)
    nome                        TEXT,           -- Nome do empreendimento (exibição)
    endereco                    TEXT,
    uf                          TEXT,
    linha                       TEXT,
    tipologia                   TEXT,
    tipo_permuta                TEXT,
    perc_permuta                TEXT,
    vgv                         TEXT,
    gestao                      TEXT,
    firme                       TEXT,
    data_assinatura_contrato    TEXT,
    status                      TEXT,
    observacao                  TEXT,
    landbank_id                 TEXT,
    perc_ebm                    TEXT,
    vgv_ebm                     TEXT,
    scp_mais_mutuo              TEXT,
    perc_ebm_menos_scp          TEXT,
    investimento_por_cc         TEXT,
    apl_empreendimento          NUMERIC,        -- APL total do empreendimento (métrica central)
    preco_m2_atual              TEXT,
    tempo_obras_meses           TEXT,
    mutuos_apl                  NUMERIC,
    scp_apl                     NUMERIC,
    mutuos_mais_scp_apl         NUMERIC,
    data_lancamento             TEXT,
    permuta_fisica_area         TEXT,
    perc_scp_final              TEXT,
    mutuos_rs                   TEXT,
    scp_rs                      TEXT,
    cidade                      TEXT,
    regional                    TEXT,
    tipo                        TEXT,
    pipe_alvo                   TEXT,
    area                        TEXT,
    latitude                    TEXT,
    longitude                   TEXT,
    valor_alvo_venda_terreno    TEXT,
    status_venda_terreno        TEXT,
    data_prevista_venda         TEXT,
    data_previsao_recebimento   TEXT,
    -- Controle de carga
    carregado_em                TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────
-- raw.investidores
-- Fonte: INVESTIDORES.csv
-- Dimensão de investidores (lista canônica)
-- ─────────────────────────────
CREATE TABLE IF NOT EXISTS raw.investidores (
    id                          SERIAL PRIMARY KEY,
    nome_investidor             TEXT NOT NULL,  -- Chave de exibição e join
    valor_investido             TEXT,
    valor_parcela               TEXT,
    endereco                    TEXT,
    contato                     TEXT,
    data_ultimo_investimento    TEXT,
    data_nascimento             TEXT,
    proximo_aniversario         TEXT,
    aniversario                 TEXT,
    investidor_id               TEXT,
    data_aniversario_2026       TEXT,
    carregado_em                TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────
-- raw.gestao_investidores
-- Fonte: GESTAO_DE_INVESTIDORES.csv
-- Fato central: relação investidor x empreendimento x valores
-- ─────────────────────────────
CREATE TABLE IF NOT EXISTS raw.gestao_investidores (
    id                          SERIAL PRIMARY KEY,
    gestao_id                   TEXT,           -- Id original do SharePoint
    obra_id                     TEXT,           -- FK -> raw.landbank.titulo
    centro_custo                TEXT,           -- FK alternativa -> raw.landbank.titulo
    tipo_scp                    TEXT,
    nome_investidor             TEXT,           -- FK -> raw.investidores.nome_investidor
    socia_ostensiva             TEXT,
    socia_participante          TEXT,
    valor_investido             NUMERIC,        -- Medida principal
    apl_invest                  NUMERIC,        -- APL do investidor (medida)
    tir_investidor              TEXT,
    data_assinatura             TEXT,
    custos_investidor           TEXT,
    garantia                    TEXT,
    observacoes                 TEXT,
    comissao                    TEXT,
    status                      TEXT,
    ativo_inativo               TEXT,
    email                       TEXT,
    telefones                   TEXT,
    data_lancamento             TEXT,
    data_conclusao              TEXT,
    penalidade_lancamento       TEXT,
    penalidade_conclusao        TEXT,
    status_final                TEXT,
    plano_de_acao               TEXT,
    nome_intermediador          TEXT,
    empreendimento_lancado      TEXT,
    data_lancamento_tolerancia  TEXT,
    data_conclusao_tolerancia   TEXT,
    status_acerto               TEXT,
    carregado_em                TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────
-- raw.apl_valor_contrato
-- Fonte: APL_VLR_CONTRATO.csv
-- Tabela de contratos e áreas físicas
-- ─────────────────────────────
CREATE TABLE IF NOT EXISTS raw.apl_valor_contrato (
    id                          SERIAL PRIMARY KEY,
    centro_custos               TEXT,           -- FK -> raw.landbank.titulo
    empreendimento              TEXT,
    investidor                  TEXT,           -- FK -> raw.investidores.nome_investidor
    titulo                      TEXT,
    numero_cliente              TEXT,
    tipo_contrato               TEXT,
    possibilidade_conversao     TEXT,
    status                      TEXT,
    data_assinatura_contrato    TEXT,
    area                        NUMERIC,
    valor_contrato              NUMERIC,
    carregado_em                TIMESTAMPTZ DEFAULT NOW()
);
"""

# ── View Analytics: Controle de Investidores ────
VIEW_CONTROLE = """
CREATE SCHEMA IF NOT EXISTS analytics;

-- Drop e recria a view para garantir atualização
DROP VIEW IF EXISTS analytics.v_controle_investidores;

CREATE VIEW analytics.v_controle_investidores AS
SELECT
    lb.nome                                                         AS nome_empreendimento,
    gi.nome_investidor,
    gi.empreendimento_lancado,
    gi.tipo_scp                                                     AS tipo_investimento,
    gi.nome_intermediador                                           AS intermediador,
    gi.data_assinatura,
    COALESCE(gi.valor_investido, 0)                                 AS valor_investido,
    COALESCE(gi.apl_invest, 0)                                      AS apl_investidor,
    COALESCE(lb.apl_empreendimento, 0)                              AS apl_empreendimento,
    CASE
        WHEN COALESCE(lb.apl_empreendimento, 0) > 0
        THEN ROUND((COALESCE(gi.apl_invest, 0) / lb.apl_empreendimento) * 100, 2)
        ELSE 0
    END                                                             AS perc_apl_comprometida,
    gi.status,
    gi.ativo_inativo,
    gi.plano_de_acao,
    gi.status_acerto,
    gi.data_lancamento_tolerancia,
    gi.data_conclusao_tolerancia,
    gi.obra_id,
    gi.centro_custo
FROM raw.gestao_investidores gi
-- INNER JOIN: garante que so retorna registros com empreendimento real no LANDBANK
INNER JOIN raw.landbank lb
    ON gi.obra_id = lb.titulo
    OR gi.centro_custo = lb.titulo
WHERE COALESCE(gi.ativo_inativo, '') <> 'Inativo'
  AND lb.nome IS NOT NULL
  AND lb.nome <> '';

-- View dimensão empreendimentos (para dropdown do filtro — sem "Obra XXX")
DROP VIEW IF EXISTS analytics.v_dim_empreendimentos;
CREATE VIEW analytics.v_dim_empreendimentos AS
SELECT DISTINCT
    titulo,
    nome,
    status,
    cidade,
    regional,
    apl_empreendimento
FROM raw.landbank
WHERE nome IS NOT NULL AND nome <> ''
ORDER BY nome;

-- View dimensão investidores (para dropdown do filtro)
DROP VIEW IF EXISTS analytics.v_dim_investidores;
CREATE VIEW analytics.v_dim_investidores AS
SELECT
    nome_investidor,
    data_nascimento,
    aniversario,
    data_aniversario_2026,
    contato,
    endereco
FROM raw.investidores
WHERE nome_investidor IS NOT NULL AND nome_investidor <> ''
ORDER BY nome_investidor;
"""


# ── Carga de dados ──────────────────────────────
def safe_numeric(val):
    if val is None:
        return None
    v = str(val).strip().replace('R$', '').replace('\xa0', '').replace('.', '').replace(',', '.').strip()
    try:
        return float(v) if v else None
    except ValueError:
        return None


def load_landbank(cur, filepath: Path):
    print("Carregando LANDBANK...")
    headers, rows = read_csv(filepath)
    cur.execute("TRUNCATE raw.landbank RESTART IDENTITY CASCADE")

    insert_rows = []
    for r in rows:
        def g(keys):
            for k in keys:
                v = r.get(k, '')
                if v: return v
            return ''

        insert_rows.append((
            g(['Ttulo', 'Título', 'Titulo']),                  # titulo
            g(['Nome', 'nome']),                                # nome
            g(['Endereço', 'Endereco', 'Endere\xe7o']),         # endereco
            g(['UF']),                                           # uf
            g(['Linha']),                                        # linha
            g(['Tipologia']),                                    # tipologia
            g(['Tipo Permuta']),                                 # tipo_permuta
            g(['% de Permuta']),                                 # perc_permuta
            g(['VGV']),                                          # vgv
            g(['Gestão', 'Gestao', 'Gest\xe3o']),               # gestao
            g(['Firme']),                                        # firme
            g(['Data Assinatura Contrato']),                     # data_assinatura_contrato
            g(['Status']),                                       # status
            g(['Observação', 'Observacao']),                     # observacao
            g(['ID']),                                           # landbank_id
            g(['% EBM']),                                        # perc_ebm
            g(['VGV EBM']),                                      # vgv_ebm
            g(['SCP + MÚTUO', 'SCP + Mtuo', 'SCP + MUTUO']),   # scp_mais_mutuo
            g(['% EBM - % SCP']),                                # perc_ebm_menos_scp
            g(['Investimento por CC']),                          # investimento_por_cc
            safe_numeric(g(['APL do empreendimento'])),          # apl_empreendimento
            g(['Preço do m² atual', 'Preo do m atual']),        # preco_m2_atual
            g(['Tempo de obras (meses)']),                       # tempo_obras_meses
            safe_numeric(g(['Mútuos (APL)', 'Mtuos (APL)'])),  # mutuos_apl
            safe_numeric(g(['SCP (APL)'])),                      # scp_apl
            safe_numeric(g(['Mútuos + SCP (APL)', 'Mtuos + SCP (APL)'])),  # mutuos_mais_scp_apl
            g(['Data de Lançamento', 'Data de Lanamento']),      # data_lancamento
            g(['Permuta Física (em área privativa)']),           # permuta_fisica_area
            g(['% SCP Final']),                                  # perc_scp_final
            g(['Mútuos (R$)', 'Mtuos (R$)']),                   # mutuos_rs
            g(['SCP (R$)']),                                     # scp_rs
            g(['Cidade']),                                       # cidade
            g(['Regional']),                                     # regional
            g(['TIPO']),                                         # tipo
            g(['PIPE Alvo']),                                    # pipe_alvo
            g(['Área', 'Area', '\xc1rea']),                     # area
            g(['Latitude']),                                     # latitude
            g(['Longitude']),                                    # longitude
            g(['Valor alvo de venda do terreno']),               # valor_alvo_venda_terreno
            g(['Status venda terreno']),                         # status_venda_terreno
            g(['Data prevista venda']),                          # data_prevista_venda
            g(['Data previsão recebimento']),                    # data_previsao_recebimento
        ))

    execute_values(cur, """
        INSERT INTO raw.landbank (
            titulo, nome, endereco, uf, linha, tipologia, tipo_permuta, perc_permuta,
            vgv, gestao, firme, data_assinatura_contrato, status, observacao, landbank_id,
            perc_ebm, vgv_ebm, scp_mais_mutuo, perc_ebm_menos_scp, investimento_por_cc,
            apl_empreendimento, preco_m2_atual, tempo_obras_meses, mutuos_apl, scp_apl,
            mutuos_mais_scp_apl, data_lancamento, permuta_fisica_area, perc_scp_final,
            mutuos_rs, scp_rs, cidade, regional, tipo, pipe_alvo, area, latitude, longitude,
            valor_alvo_venda_terreno, status_venda_terreno, data_prevista_venda, data_previsao_recebimento
        ) VALUES %s
    """, insert_rows)
    print(f"  -> {len(insert_rows)} empreendimentos carregados.")


def load_investidores(cur, filepath: Path):
    print("Carregando INVESTIDORES...")
    headers, rows = read_csv(filepath)
    cur.execute("TRUNCATE raw.investidores RESTART IDENTITY CASCADE")

    insert_rows = []
    for r in rows:
        nome = r.get('Nome do Investidor', '').strip()
        if not nome:
            continue
        insert_rows.append((
            nome,
            r.get('Valor Investido', ''),
            r.get('Valor da Parcela', ''),
            r.get('Endereço', r.get('Endere\xe7o', '')),
            r.get('Contato (telefone e e-mail)', ''),
            r.get('Data do Último Investimento', r.get('Data do \xdaltimo Investimento', '')),
            r.get('Data de Nascimento', ''),
            r.get('Próximo aniversário', r.get('Pr\xf3ximo anivers\xe1rio', '')),
            r.get('Aniversário', r.get('Anivers\xe1rio', '')),
            r.get('ID', ''),
            r.get('Data Aniversario 2026', ''),
        ))

    execute_values(cur, """
        INSERT INTO raw.investidores (
            nome_investidor, valor_investido, valor_parcela, endereco, contato,
            data_ultimo_investimento, data_nascimento, proximo_aniversario,
            aniversario, investidor_id, data_aniversario_2026
        ) VALUES %s
    """, insert_rows)
    print(f"  -> {len(insert_rows)} investidores carregados.")


def load_gestao(cur, filepath: Path):
    print("Carregando GESTÃO DE INVESTIDORES...")
    headers, rows = read_csv(filepath)
    cur.execute("TRUNCATE raw.gestao_investidores RESTART IDENTITY CASCADE")

    insert_rows = []
    for r in rows:
        def g(keys):
            for k in keys:
                v = r.get(k, None)
                if v is not None and str(v).strip():
                    return str(v).strip()
            return None

        insert_rows.append((
            g(['Id']),
            g(['ObraId']),
            g(['Centro de Custo']),
            g(['Tipo de SCP']),
            g(['Nome do Investidor']),
            g(['Sócia Ostensiva', 'S\xf3cia Ostensiva']),
            g(['Sócia Participante', 'S\xf3cia Participante']),
            safe_numeric(g(['Valor Investido'])),
            safe_numeric(g(['apl_invest'])),
            g(['TIR do investidor']),
            g(['Data assinatura']),
            g(['Custos Investidor']),
            g(['Garantia']),
            g(['Observações', 'Observa\xe7\xf5es']),
            g(['Comissão (_x00', 'Comiss\xe3o (_x00']),
            g(['Status']),
            g(['Ativo/Inativo']),
            g(['E-mail']),
            g(['Telefones']),
            g(['Data de Lançamento', 'Data de Lan\xe7amento']),
            g(['Data de Conclusão', 'Data de Conclus\xe3o']),
            g(['Penalidade lan\xe7ament', 'Penalidade lançament']),
            g(['Penalidadeconclus\xe3o', 'Penalidadeconclusão']),
            g(['StatusFinal']),
            g(['PlanodeAção', 'PlanodeA\xe7\xe3o']),
            g(['Nome do Intermediado']),
            g(['Empreendimentolan\xe7ado', 'Empreendimentolançado']),
            g(['Datadelan\xe7amentocomtoler_x', 'Datadelançamentocomtoler_x']),
            g(['Datadeconclusãocomtoler_x0', 'Datadeconclus\xe3ocomtoler_x0']),
            g(['Status Acerto']),
        ))

    execute_values(cur, """
        INSERT INTO raw.gestao_investidores (
            gestao_id, obra_id, centro_custo, tipo_scp, nome_investidor,
            socia_ostensiva, socia_participante, valor_investido, apl_invest,
            tir_investidor, data_assinatura, custos_investidor, garantia,
            observacoes, comissao, status, ativo_inativo, email, telefones,
            data_lancamento, data_conclusao, penalidade_lancamento, penalidade_conclusao,
            status_final, plano_de_acao, nome_intermediador, empreendimento_lancado,
            data_lancamento_tolerancia, data_conclusao_tolerancia, status_acerto
        ) VALUES %s
    """, insert_rows)
    print(f"  -> {len(insert_rows)} registros de gestão carregados.")


def load_contratos(cur, filepath: Path):
    print("Carregando APL / VALOR DO CONTRATO...")
    headers, rows = read_csv(filepath)
    cur.execute("TRUNCATE raw.apl_valor_contrato RESTART IDENTITY CASCADE")

    insert_rows = []
    for r in rows:
        def g(keys):
            for k in keys:
                v = r.get(k, None)
                if v is not None and str(v).strip():
                    return str(v).strip()
            return None
        insert_rows.append((
            g(['Centro de Custos']),
            g(['Empreedimento', 'Empreendimento']),
            g(['Investidor']),
            g(['Título', 'T\xedtulo', 'Ttulo']),
            g(['Número do Cliente', 'N\xfamero do Cliente']),
            g(['Tipo de Contrato']),
            g(['Possibilidade de conversão para Mútuo', 'Possibilidade de convers\xe3o para M\xfatuo']),
            g(['Status']),
            g(['Data de Assinatura do Contrato']),
            safe_numeric(g(['Área', '\xc1rea', 'Area'])),
            safe_numeric(g(['Valor do Contrato'])),
        ))

    execute_values(cur, """
        INSERT INTO raw.apl_valor_contrato (
            centro_custos, empreendimento, investidor, titulo, numero_cliente,
            tipo_contrato, possibilidade_conversao, status,
            data_assinatura_contrato, area, valor_contrato
        ) VALUES %s
    """, insert_rows)
    print(f"  -> {len(insert_rows)} contratos carregados.")


# ── Main ─────────────────────────────────────────
def main():
    print("=" * 50)
    print("Iniciando carga para Neon/PostgreSQL")
    print("=" * 50)

    conn = get_conn()
    conn.autocommit = False
    cur = conn.cursor()

    try:
        print("\n[1/6] Criando schemas e tabelas...")
        cur.execute(DDL)

        print("\n[2/6] Carregando LANDBANK...")
        load_landbank(cur, BASE_DIR / "LANDBANK.csv")

        print("\n[3/6] Carregando INVESTIDORES...")
        load_investidores(cur, BASE_DIR / "INVESTIDORES.csv")

        print("\n[4/6] Carregando GESTÃO DE INVESTIDORES...")
        load_gestao(cur, BASE_DIR / "GESTAO_DE_INVESTIDORES.csv")

        print("\n[5/6] Carregando APL / VALOR DO CONTRATO...")
        load_contratos(cur, BASE_DIR / "APL_VLR_CONTRATO.csv")

        print("\n[6/6] Criando views analytics...")
        cur.execute(VIEW_CONTROLE)

        conn.commit()
        print("\n[OK] Carga concluída com sucesso!")
        print("Views criadas:")
        print("  - analytics.v_controle_investidores")
        print("  - analytics.v_dim_empreendimentos")
        print("  - analytics.v_dim_investidores")

    except Exception as e:
        conn.rollback()
        print(f"\n[ERRO] ERRO: {e}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
