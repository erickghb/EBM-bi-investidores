"""
fix_view.py
-----------
Atualiza a view v_controle_investidores para retornar apenas registros
que tiveram JOIN real com o LANDBANK (nome de empreendimento real).
Elimina os "Empreendimento XXX" de obras antigas sem cadastro.
"""
import os
import psycopg2
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(r'C:\Users\erick.aires\Migracao_BI\.env'))
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
conn.autocommit = True
cur = conn.cursor()

# Recria a view usando INNER JOIN — só retorna quando há match real no LANDBANK
VIEW_SQL = """
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
-- INNER JOIN: exige match real no LANDBANK
INNER JOIN raw.landbank lb
    ON gi.obra_id = lb.titulo
    OR gi.centro_custo = lb.titulo
WHERE COALESCE(gi.ativo_inativo, '') <> 'Inativo'
  AND lb.nome IS NOT NULL
  AND lb.nome <> '';
"""

print("Atualizando view analytics.v_controle_investidores...")
cur.execute(VIEW_SQL)
print("View atualizada.")

# Valida o resultado
cur.execute("SELECT COUNT(*) FROM analytics.v_controle_investidores")
total = cur.fetchone()[0]
print(f"Total de registros na view: {total}")

cur.execute("SELECT COUNT(DISTINCT nome_empreendimento) FROM analytics.v_controle_investidores")
emps = cur.fetchone()[0]
print(f"Empreendimentos distintos: {emps}")

# Confirma que nao ha mais nomes invalidos
cur.execute("SELECT COUNT(*) FROM analytics.v_controle_investidores WHERE nome_empreendimento ILIKE 'Empreendimento %' OR nome_empreendimento ILIKE 'Obra %'")
invalidos = cur.fetchone()[0]
print(f"Registros sem nome real: {invalidos} (esperado: 0)")

# Mostra os 5 primeiros para conferencia visual
cur.execute("""
    SELECT nome_empreendimento, nome_investidor, valor_investido, perc_apl_comprometida
    FROM analytics.v_controle_investidores
    ORDER BY nome_empreendimento, nome_investidor
    LIMIT 5
""")
print("\n=== Amostra da view corrigida ===")
for row in cur.fetchall():
    emp, inv, val, pct = row
    print(f"  {str(emp)[:35]:<35} | {str(inv)[:25]:<25} | R$ {float(val or 0):>15,.2f} | {pct}%")

cur.close()
conn.close()
print("\nConcluido.")
