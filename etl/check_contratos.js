const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const res = await pool.query(`
    SELECT
      SUBSTRING(data_assinatura FROM '[0-9]{4}')::INT AS ano,
      SUM(COALESCE(valor_investido, 0)) AS valor
    FROM raw.gestao_investidores
    WHERE data_assinatura IS NOT NULL
      AND data_assinatura ~ '[0-9]{4}'
      AND COALESCE(ativo_inativo, '') <> 'Inativo'
    GROUP BY ano
    ORDER BY ano
  `);

  console.log("=== RAW.GESTAO_INVESTIDORES POR ANO ===");
  let acum = 0;
  res.rows.forEach(r => {
    const val = parseFloat(r.valor);
    acum += val;
    console.log(`Ano: ${r.ano} | Contratos: R$ ${val.toLocaleString('pt-BR', {minimumFractionDigits: 2})} | Acumulado: R$ ${acum.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`);
  });

  pool.end();
}

main();
