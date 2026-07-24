import os, psycopg2, psycopg2.extras
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path('C:/Users/erick.aires/Migracao_BI/.env'))
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

cur.execute("""
    WITH mensal AS (
      SELECT
        EXTRACT(YEAR FROM data_assinatura)::INT AS ano,
        EXTRACT(MONTH FROM data_assinatura)::INT AS mes,
        SUM(COALESCE(valor_contrato, 0)) AS valor_mes
      FROM raw.apl_vlr_contrato
      WHERE data_assinatura IS NOT NULL
        AND status NOT IN ('DEVOLVIDO C/CORRECAO', 'DEVOLVIDO C/CORREÇÃO')
      GROUP BY 1, 2
    ),
    acumulado AS (
      SELECT ano, mes, valor_mes,
        SUM(valor_mes) OVER (ORDER BY ano, mes ROWS UNBOUNDED PRECEDING) AS valor_acumulado
      FROM mensal
    )
    SELECT ano,
      SUM(valor_mes) AS valor_ano,
      MAX(valor_acumulado) AS acumulado_ano
    FROM acumulado
    GROUP BY ano
    ORDER BY ano;
""")
rows = cur.fetchall()
print("=== CONTRATOS ASSINADOS POR ANO (QUERY OFICIAL) ===")
for r in rows:
    print(f"Ano: {r['ano']} | R$ Contratos: R$ {float(r['valor_ano']):15,.2f} | R$ Contratos Acumulados: R$ {float(r['acumulado_ano']):15,.2f}")
