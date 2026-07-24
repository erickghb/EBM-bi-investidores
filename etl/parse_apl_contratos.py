import csv, re

def parse_brl(s):
    if not s: return 0.0
    s = re.sub(r'[R$\s]', '', s.strip())
    s = s.replace('.', '').replace(',', '.')
    try: return float(s) if s else 0.0
    except: return 0.0

with open(r'C:\Users\erick.aires\Migracao_BI\data\APL_VLR_CONTRATO.csv', encoding='cp1252', errors='replace') as f:
    reader = list(csv.DictReader(f, delimiter=';'))

print("Total linhas em APL_VLR_CONTRATO:", len(reader))

anos = {}
tot = 0
for r in reader:
    status = r.get('Status', '').strip()
    if status in ['DEVOLVIDO C/CORRECAO', 'DEVOLVIDO C/CORREÇÃO']:
        continue
    data = r.get('Data de Assinatura do Contrato', '').strip()
    # Procurar 4 digitos para ano
    match = re.search(r'20\d\d', data)
    ano = match.group(0) if match else 'Sem Ano'
    val = parse_brl(r.get('Valor do Contrato', ''))
    anos[ano] = anos.get(ano, 0.0) + val
    tot += val

print("=== CONTRATOS POR ANO (APL_VLR_CONTRATO.csv) ===")
acum = 0
for ano in sorted(anos.keys()):
    val = anos[ano]
    acum += val
    print(f"Ano: {ano} | Contratos: R$ {val:15,.2f} | Acumulado: R$ {acum:15,.2f}")

print(f"Total Geral: R$ {tot:,.2f}")
