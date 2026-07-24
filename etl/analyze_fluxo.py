import csv, re
from collections import defaultdict

def read_csv(path):
    with open(path, encoding='cp1252', errors='replace') as f:
        return list(csv.DictReader(f, delimiter=';'))

fluxo = read_csv(r'C:\Users\erick.aires\Migracao_BI\data\FLUXO_ENTRADA.csv')

print('=== Exemplos do campo Realizado ===')
for r in fluxo[:5]:
    cc   = r['Centro de Custos']
    real = r['Realizado']
    arealizar = r['A realizar']
    data = r['Data do Pagamento']
    print(f'  CC={cc} | Real={repr(real)} | ARealizar={repr(arealizar)} | Data={data}')

def parse_brl(s):
    s = s.strip()
    # Remove R$, espacos, pontos de milhar, troca virgula por ponto
    s = re.sub(r'[R$\s]', '', s)
    s = s.replace('.', '').replace(',', '.')
    try:
        return float(s) if s else 0.0
    except:
        return 0.0

total_realizado   = sum(parse_brl(r['Realizado']) for r in fluxo)
total_a_realizar  = sum(parse_brl(r['A realizar']) for r in fluxo)

print(f'\nTotal Realizado:   R$ {total_realizado:,.2f}')
print(f'Total A Realizar:  R$ {total_a_realizar:,.2f}')

por_emp = defaultdict(lambda: {'realizado': 0.0, 'a_realizar': 0.0, 'qtd': 0})
for r in fluxo:
    emp = r['Empreendimento'].strip()
    por_emp[emp]['realizado']  += parse_brl(r['Realizado'])
    por_emp[emp]['a_realizar'] += parse_brl(r['A realizar'])
    por_emp[emp]['qtd']        += 1

print()
print('=== POR EMPREENDIMENTO ===')
for emp, v in sorted(por_emp.items(), key=lambda x: -x[1]['realizado']):
    emp30 = emp[:40].ljust(40)
    print(f'  {emp30} | Realizado: R$ {v["realizado"]:>15,.2f} | A realizar: R$ {v["a_realizar"]:>15,.2f} | Qtd parcelas: {v["qtd"]}')

print()
print('=== STATUS DISTINTOS ===')
status = defaultdict(int)
for r in fluxo:
    status[r['Status'].strip()] += 1
for s, c in sorted(status.items(), key=lambda x: -x[1]):
    print(f'  {s}: {c}')

print()
print('=== ANOS PRESENTES NO FLUXO ===')
anos = defaultdict(float)
for r in fluxo:
    data = r['Data do Pagamento'].strip()
    # Formato: "03/nov/23" ou "01/dez/23"
    partes = data.split('/')
    if len(partes) == 3:
        ano = '20' + partes[2] if len(partes[2]) == 2 else partes[2]
        anos[ano] += parse_brl(r['Realizado'])
for ano, v in sorted(anos.items()):
    print(f'  {ano}: R$ {v:,.2f}')
