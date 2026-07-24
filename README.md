# EBM Inteligência — Migração BI Investidores Web

Aplicação web de acompanhamento de investidores, migrada a partir do Power BI (PBIX),
com dados hospedados no Neon/PostgreSQL e interface em HTML/CSS/JS.

## Estrutura do Projeto

```
Migracao_BI/
├── .env.example          → Template das variáveis de ambiente
├── .env                  → Segredos reais (NÃO commitar)
├── .gitignore
├── requirements.txt
├── README.md
│
├── data/                 → Exportações CSV do PBIX (atualizar semanalmente)
│   ├── LANDBANK.csv
│   ├── INVESTIDORES.csv
│   ├── GESTAO_DE_INVESTIDORES.csv
│   └── APL_VLR_CONTRATO.csv
│
├── etl/                  → Scripts de carga para o banco
│   └── load_to_neon.py
│
├── api/                  → Backend Flask (porta 5000)
│   └── api.py
│
├── frontend/             → Interface web
│   ├── index.html
│   ├── index.css
│   └── app.js
│
└── reference/            → Artefatos de referência (não modificar)
    └── pbix_extract/     → PBIX descompactado para consulta de lógica
```

## Pré-requisitos

- Python 3.9+
- Conta no [Neon.tech](https://neon.tech)

## Instalação

```bash
# 1. Instalar dependências
pip install -r requirements.txt

# 2. Configurar variáveis de ambiente
copy .env.example .env
# Edite .env e preencha DATABASE_URL com a string de conexão do Neon
```

## Carga de Dados (executar semanalmente)

```bash
python etl/load_to_neon.py
```

O script é **idempotente**: pode ser re-executado sem duplicar dados.

## Rodar a API

```bash
python api/api.py
# API disponível em http://localhost:5000
```

## Abrir o Frontend

Abra `frontend/index.html` diretamente no navegador.

> A API deve estar rodando na porta 5000 para os dados carregarem.

## Endpoints da API

| Endpoint | Descrição |
|----------|-----------|
| `GET /api/status` | Health check |
| `GET /api/dimensoes` | Listas para dropdowns (empreendimentos, investidores) |
| `GET /api/controle` | Dados da tela Gestão à Vista + KPIs |
| `GET /api/aniversarios` | Dados da tela Aniversários |

## Atualização Semanal dos Dados

1. Exportar as 4 tabelas do Power BI Desktop em CSV (codificação Windows-1252, separador `;`)
2. Salvar na pasta `data/` substituindo os arquivos anteriores
3. Executar `python etl/load_to_neon.py`
