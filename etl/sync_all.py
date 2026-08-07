"""
sync_all.py
-----------
Sincroniza automaticamente todos os dados das listas do SharePoint e do Excel no OneDrive
sem precisar de licença Premium do Power Automate!

Pastas monitoradas no OneDrive:
1. JSONs do SharePoint (gerados pelo Power Automate Standard):
   "C:\\Users\\erick.aires\\OneDrive - EBM\\Intranet EBM - ENN\\ENN - ERICK\\POWER BI - INVESTIDORES"
   - gestao_investidores_sp.json -> raw.gestao_investidores
   - landbank_sp.json             -> raw.landbank
   - investidores_sp.json         -> raw.investidores

2. Excel no OneDrive:
   "C:\\Users\\erick.aires\\OneDrive - EBM\\Intranet EBM - EIM\\BI\\Investidores\\Fluxo entrada Investidores - Pagamentos.xlsx"
   - Aba 'FLUXO DE ENTRADA'       -> raw.fluxo_entrada
   - Aba 'APL-Valor do CT'         -> raw.apl_valor_contrato
"""

import os
import json
import openpyxl
import psycopg2
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

DATABASE_URL = os.getenv("DATABASE_URL")
ONEDRIVE_DIR = r"C:\Users\erick.aires\OneDrive - EBM\Intranet EBM - ENN\ENN - ERICK\POWER BI - INVESTIDORES"
EXCEL_PATH = r"C:\Users\erick.aires\OneDrive - EBM\Intranet EBM - EIM\BI\Investidores\Fluxo entrada Investidores - Pagamentos.xlsx"
JSON_CACHE_PATH = BASE_DIR / "api" / "fresh_fluxo_data.json"

def clean_str(val):
    if val is None:
        return None
    s = str(val).strip()
    return s if s != "" else None

def clean_num(val):
    if val is None:
        return 0.0
    try:
        return float(val)
    except:
        return 0.0

def clean_date(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except:
            pass
    return None

def sync():
    print("=" * 60)
    print("🚀 INICIANDO SINCRONIZAÇÃO COMPLETA (ONEDRIVE + SHAREPOINT)")
    print("=" * 60)

    # 1. Carregar JSON de Gestão de Investidores do OneDrive (se existir)
    gestao_json_path = os.path.join(ONEDRIVE_DIR, "gestao_investidores_sp.json")
    gestao_items = []
    if os.path.exists(gestao_json_path):
        try:
            with open(gestao_json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                gestao_items = data.get("items", data) if isinstance(data, dict) else data
            print(f"[1/3] SharePoint Gestão de Investidores: {len(gestao_items)} itens lidos de {gestao_json_path}")
        except Exception as e:
            print(f"[AVISO] Erro ao ler {gestao_json_path}: {e}")
    else:
        print(f"[1/3] {gestao_json_path} ainda não foi gerado pelo Power Automate.")

    # 2. Carregar JSON de Landbank do OneDrive (se existir)
    landbank_json_path = os.path.join(ONEDRIVE_DIR, "landbank_sp.json")
    landbank_items = []
    if os.path.exists(landbank_json_path):
        try:
            with open(landbank_json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                landbank_items = data.get("items", data) if isinstance(data, dict) else data
            print(f"[2/3] SharePoint Landbank: {len(landbank_items)} itens lidos de {landbank_json_path}")
        except Exception as e:
            print(f"[AVISO] Erro ao ler {landbank_json_path}: {e}")

    # 3. Ler Excel de Fluxo e APL
    fluxo_rows, apl_rows = [], []
    fluxo_json, apl_json = [], []

    if os.path.exists(EXCEL_PATH):
        print(f"[3/3] Lendo Excel do OneDrive:\n   {EXCEL_PATH}")
        wb = openpyxl.load_workbook(EXCEL_PATH, read_only=True, data_only=True)

        if "FLUXO DE ENTRADA" in wb.sheetnames:
            ws_fluxo = wb["FLUXO DE ENTRADA"]
            for row in ws_fluxo.iter_rows(min_row=2, values_only=True):
                if not any(row):
                    continue
                cc, emp, inv = clean_str(row[0]), clean_str(row[1]), clean_str(row[2])
                tit, cli = clean_str(row[3]), clean_str(row[4])
                tipo_ct, poss_mut = clean_str(row[5]), clean_str(row[6])
                status = clean_str(row[7])
                dt_pag = clean_date(row[8])
                realizado, previsto = clean_num(row[9]), clean_num(row[10])

                if not emp and not inv and not tit:
                    continue

                fluxo_rows.append((cc, emp, inv, tit, cli, tipo_ct, tipo_ct, poss_mut, status, dt_pag, realizado, previsto))
                fluxo_json.append({
                    "centro_custos": cc, "empreendimento": emp, "investidor": inv, "titulo": tit,
                    "numero_cliente": cli, "tipo_investimento": tipo_ct, "tipo_contrato": tipo_ct,
                    "possibilidade_conversao_mutuo": poss_mut, "status": status, "data_pagamento": dt_pag,
                    "realizado": realizado, "previsto": previsto
                })

        if "APL-Valor do CT" in wb.sheetnames:
            ws_apl = wb["APL-Valor do CT"]
            for row in ws_apl.iter_rows(min_row=2, values_only=True):
                if not any(row):
                    continue
                cc, emp, inv = clean_str(row[0]), clean_str(row[1]), clean_str(row[2])
                tit, cli = clean_str(row[3]), clean_str(row[4])
                tipo_ct, poss_mut = clean_str(row[5]), clean_str(row[6])
                status = clean_str(row[7])
                dt_ass = clean_date(row[8])
                area, vlr_ct = clean_num(row[9]), clean_num(row[10])

                if not emp and not inv and not tit:
                    continue

                apl_rows.append((cc, emp, inv, tit, cli, tipo_ct, poss_mut, status, dt_ass, area, vlr_ct))
                apl_json.append({
                    "centro_custos": cc, "empreendimento": emp, "investidor": inv, "titulo": tit,
                    "numero_cliente": cli, "tipo_contrato": tipo_ct, "possibilidade_conversao": poss_mut,
                    "status": status, "data_assinatura_contrato": dt_ass, "area": area, "valor_contrato": vlr_ct
                })

        wb.close()
        print(f"   -> Fluxo: {len(fluxo_rows)} parcelas | APL: {len(apl_rows)} contratos.")

    # Atualizar cache JSON
    cache_data = {
        "fluxo": fluxo_json,
        "apl": apl_json,
        "updated_at": datetime.now().isoformat()
    }
    with open(JSON_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache_data, f, ensure_ascii=False, indent=2)

    # Tentar conexão PostgreSQL se disponível
    if DATABASE_URL:
        try:
            conn = psycopg2.connect(DATABASE_URL, connect_timeout=5)
            cur = conn.cursor()

            if fluxo_rows:
                cur.execute("ALTER TABLE raw.fluxo_entrada ADD COLUMN IF NOT EXISTS tipo_investimento TEXT")
                cur.execute("ALTER TABLE raw.fluxo_entrada ADD COLUMN IF NOT EXISTS tipo_contrato TEXT")
                cur.execute("ALTER TABLE raw.fluxo_entrada ADD COLUMN IF NOT EXISTS possibilidade_conversao_mutuo TEXT")
                cur.execute("TRUNCATE raw.fluxo_entrada RESTART IDENTITY CASCADE")
                cur.executemany("""
                    INSERT INTO raw.fluxo_entrada (
                        centro_custos, empreendimento, investidor, titulo, numero_cliente,
                        tipo_investimento, tipo_contrato, possibilidade_conversao_mutuo,
                        status, data_pagamento, realizado, previsto
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, fluxo_rows)

            if apl_rows:
                cur.execute("ALTER TABLE raw.apl_valor_contrato ADD COLUMN IF NOT EXISTS valor_contrato NUMERIC")
                cur.execute("TRUNCATE raw.apl_valor_contrato RESTART IDENTITY CASCADE")
                cur.executemany("""
                    INSERT INTO raw.apl_valor_contrato (
                        centro_custos, empreendimento, investidor, titulo, numero_cliente,
                        tipo_contrato, possibilidade_conversao, status,
                        data_assinatura_contrato, area, valor_contrato
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, apl_rows)

            conn.commit()
            cur.close()
            conn.close()
            print("✅ Banco Neon atualizado com sucesso!")
        except Exception as e:
            print(f"[AVISO] Conexão ao Neon PostgreSQL: {e}")

    print("\n🎉 SINCRONIZAÇÃO COMPLETA CONCLUÍDA COM SUCESSO!")
    return True

if __name__ == "__main__":
    sync()
