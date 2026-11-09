import React, { useEffect, useRef } from 'react';
import {
  Chart,
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  ArcElement,
  DoughnutController,
  PieController,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';

// tipo basico de cada item bipado no inventario
export interface InventoryRecord {
  id: string;
  sessao: string;
  operador: string;
  endereco: string;
  produto: string;
  quantidadeIms: number | '';
  quantidade: number | '';
  observacao: string;
  data: string;
  hora: string;
  timestamp: number;
  ultimaModificacao?: number;
}

Chart.register(
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  ArcElement,
  DoughnutController,
  PieController,
  Title,
  Tooltip,
  Legend,
  ChartDataLabels
);

export function formatarDataPadrao(dataStr?: string): string {
  if (!dataStr || dataStr === 'Sem Data') return 'Sem Data';
  const str = String(dataStr).split(' ')[0];
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  if (str.includes('/')) {
    const p = str.split('/');
    const dia = p[0].padStart(2, '0');
    const mesIdx = parseInt(p[1], 10) - 1;
    if (mesIdx >= 0 && mesIdx < 12) return `${dia}-${meses[mesIdx]}`;
  }
  if (str.includes('-')) {
    const p = str.split('-');
    const dia = p[0].padStart(2, '0');
    const mesTexto = p[1].toLowerCase().substring(0, 3);
    return `${dia}-${mesTexto}`;
  }
  return str;
}

export function converterParaDataNumero(dataStr?: string): number {
  if (!dataStr || dataStr === 'Sem Data') return 0;
  if (dataStr.includes('/')) {
    const p = dataStr.split('/');
    return parseInt(p[2] + p[1].padStart(2, '0') + p[0].padStart(2, '0'), 10);
  }
  if (dataStr.includes('-')) {
    const p = dataStr.split('-');
    const dia = p[0].padStart(2, '0');
    const meses: Record<string, string> = {
      jan: '01',
      fev: '02',
      feb: '02',
      mar: '03',
      abr: '04',
      apr: '04',
      mai: '05',
      may: '05',
      jun: '06',
      jul: '07',
      ago: '08',
      aug: '08',
      set: '09',
      sep: '09',
      out: '10',
      oct: '10',
      nov: '11',
      dez: '12',
      dec: '12',
    };
    const mesTexto = p[1] ? p[1].toLowerCase().substring(0, 3) : '01';
    const mesNum = meses[mesTexto] || '01';
    const ano = p[2] ? p[2] : '2026';
    return parseInt(ano + mesNum + dia, 10);
  }
  return 0;
}

export function parseBRDate(s?: string): Date {
  if (!s) return new Date(0);
  const parts = String(s).split(' ')[0].split('/');
  if (parts.length !== 3) return new Date(0);
  return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
}

export function obterTurnoOperador(
  operador: string | undefined,
  shifts: Record<string, string>,
  fallback = 'Não Definido'
): string {
  if (!operador) return fallback;
  const raw = String(operador).trim();
  const lower = raw.toLowerCase();
  return shifts[raw] || shifts[lower] || fallback;
}

interface DashboardChartsProps {
  inventario: InventoryRecord[];
  enderecos: string[];
  operators: string[];
  shifts: Record<string, string>;
  isDark: boolean;
  filtroContagensPeriodo: string;
  contagensDataIni: string;
  contagensDataFim: string;
  filtroEsperadoPeriodo: string;
  onChangeFiltroContagens: (val: string) => void;
  onChangeDataIni: (val: string) => void;
  onChangeDataFim: (val: string) => void;
  onChangeFiltroEsperado: (val: string) => void;
}

export const DashboardCharts: React.FC<DashboardChartsProps> = ({
  inventario,
  enderecos,
  operators,
  shifts,
  isDark,
  filtroContagensPeriodo,
  contagensDataIni,
  contagensDataFim,
  filtroEsperadoPeriodo,
  onChangeFiltroContagens,
  onChangeDataIni,
  onChangeDataFim,
  onChangeFiltroEsperado,
}) => {
  const contagensDiaRef = useRef<HTMLCanvasElement | null>(null);
  const contagensDiaOpRef = useRef<HTMLCanvasElement | null>(null);
  const esperadoRealizadoRef = useRef<HTMLCanvasElement | null>(null);
  const metricasSpanRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const invValido = inventario.filter((i) => enderecos.includes(i.endereco));
    const textColor = isDark ? '#fff' : '#333';
    const strokeColor = isDark ? '#1a1a2e' : '#f4f7f6';

    const enderecosPorOperador: Record<string, Set<string>> = {};
    const enderecosPorDia: Record<string, Set<string>> = {};

    invValido.forEach((item) => {
      const dataLimpa = formatarDataPadrao(item.data);
      if (!enderecosPorOperador[item.operador]) enderecosPorOperador[item.operador] = new Set();
      enderecosPorOperador[item.operador].add(item.endereco);

      if (!enderecosPorDia[dataLimpa]) enderecosPorDia[dataLimpa] = new Set();
      enderecosPorDia[dataLimpa].add(item.endereco);
    });

    const contagemOperador: Record<string, number> = {};
    for (const op in enderecosPorOperador) {
      contagemOperador[op] = enderecosPorOperador[op].size;
    }

    const contagemDia: Record<string, number> = {};
    for (const dia in enderecosPorDia) {
      contagemDia[dia] = enderecosPorDia[dia].size;
    }

    const hojeContagens = new Date();
    hojeContagens.setHours(0, 0, 0, 0);
    const diasPermitidos = new Set<string>();

    invValido.forEach((item) => {
      if (!item.data) return;
      const dbData = parseBRDate(item.data);
      let passaFiltro = false;
      if (filtroContagensPeriodo === 'tudo') passaFiltro = true;
      else if (filtroContagensPeriodo === 'hoje')
        passaFiltro = dbData.getTime() === hojeContagens.getTime();
      else if (filtroContagensPeriodo === '7dias')
        passaFiltro = (hojeContagens.getTime() - dbData.getTime()) / 86400000 <= 7;
      else if (filtroContagensPeriodo === '30dias')
        passaFiltro = (hojeContagens.getTime() - dbData.getTime()) / 86400000 <= 30;
      else if (filtroContagensPeriodo === 'mes')
        passaFiltro =
          dbData.getMonth() === hojeContagens.getMonth() &&
          dbData.getFullYear() === hojeContagens.getFullYear();
      else if (filtroContagensPeriodo === 'personalizado') {
        if (!contagensDataIni || !contagensDataFim) passaFiltro = true;
        else {
          const dIni = new Date(contagensDataIni + 'T00:00:00').getTime();
          const dFim = new Date(contagensDataFim + 'T23:59:59').getTime();
          passaFiltro = dbData.getTime() >= dIni && dbData.getTime() <= dFim;
        }
      }
      if (passaFiltro) diasPermitidos.add(formatarDataPadrao(item.data));
    });

    const diasUnicos = Object.keys(contagemDia)
      .filter((dia) => diasPermitidos.has(dia))
      .sort((a, b) => converterParaDataNumero(a) - converterParaDataNumero(b));

    const instances: Chart[] = [];

    // contagens por dia geral
    if (contagensDiaRef.current) {
      const dadosContagens = diasUnicos.map((dia) => contagemDia[dia]);
      const maiorPico = dadosContagens.length > 0 ? Math.max(...dadosContagens) : 0;

      const configEixoY: Record<string, unknown> = {
        ticks: { color: textColor },
      };

      if (maiorPico > 250) {
        configEixoY.type = 'logarithmic';
        configEixoY.max = maiorPico * 1.5;
        configEixoY.ticks = {
          color: textColor,
          callback: (value: number) => {
            if ([1, 10, 50, 100, 200, 500, 1000, 2000].includes(value)) return value;
            return null;
          },
        };
      } else {
        configEixoY.type = 'linear';
        configEixoY.beginAtZero = true;
        configEixoY.suggestedMax = maiorPico + maiorPico * 0.25;
      }

      instances.push(
        new Chart(contagensDiaRef.current, {
          type: 'line',
          data: {
            labels: diasUnicos,
            datasets: [
              {
                label: 'Total Bipado no Dia',
                data: dadosContagens,
                borderColor: '#e67e22',
                backgroundColor: '#e67e22',
                fill: false,
                tension: 0.1,
              },
              {
                label: 'Meta Diária (71)',
                data: Array(diasUnicos.length).fill(71),
                borderColor: '#2ecc71',
                backgroundColor: 'transparent',
                borderWidth: 2,
                borderDash: [5, 5],
                pointRadius: 0,
                fill: false,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 15 } },
            plugins: {
              legend: { display: false },
              datalabels: {
                color: textColor,
                font: { weight: 'bold', size: 12 },
                textStrokeColor: strokeColor,
                textStrokeWidth: 4,
                anchor: 'end',
                align: 'top',
                offset: 2,
                clip: false,
                formatter: (value: number, ctx) => {
                  if (value === 0) return '';
                  if (ctx.dataset.label && ctx.dataset.label.includes('Meta')) return '';
                  return value;
                },
              },
            },
            scales: {
              x: { ticks: { color: textColor } },
              y: configEixoY,
            },
          },
        })
      );
    }

    // top 10 produtividade dos operadores
    if (contagensDiaOpRef.current) {
      const coresOps = [
        '#3498db',
        '#e74c3c',
        '#2ecc71',
        '#9b59b6',
        '#f1c40f',
        '#1abc9c',
        '#34495e',
        '#e67e22',
        '#7f8c8d',
        '#d35400',
      ];
      const top10Operadores = Object.keys(contagemOperador)
        .sort((a, b) => contagemOperador[b] - contagemOperador[a])
        .slice(0, 10);
      const valoresTop10 = top10Operadores.map((op) => contagemOperador[op]);

      instances.push(
        new Chart(contagensDiaOpRef.current, {
          type: 'bar',
          data: {
            labels: top10Operadores,
            datasets: [
              {
                label: 'Total Contado',
                data: valoresTop10,
                backgroundColor: coresOps,
                borderWidth: 1,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              datalabels: {
                color: textColor,
                font: { weight: 'bold', size: 12 },
                textStrokeColor: strokeColor,
                textStrokeWidth: 4,
                anchor: 'end',
                align: 'top',
                formatter: (v: number) => (v > 0 ? v : ''),
              },
            },
            scales: {
              x: { ticks: { color: textColor } },
              y: { ticks: { color: textColor } },
            },
          },
        })
      );
    }

    // esperado vs realizado separado por turno
    if (esperadoRealizadoRef.current) {
      const hojeEsperado = new Date();
      hojeEsperado.setHours(0, 0, 0, 0);

      let numDiasEsperado = 1;
      if (filtroEsperadoPeriodo === 'hoje') numDiasEsperado = 1;
      else if (filtroEsperadoPeriodo === '7dias') numDiasEsperado = 7;
      else if (filtroEsperadoPeriodo === '30dias') numDiasEsperado = 30;
      else if (filtroEsperadoPeriodo === 'mes') numDiasEsperado = hojeEsperado.getDate();
      else {
        const todosDias = new Set(invValido.map((item) => formatarDataPadrao(item.data)));
        numDiasEsperado = todosDias.size > 0 ? todosDias.size : 1;
      }

      const contagemOpsTurno: Record<string, number> = {};
      operators.forEach((op) => {
        const turno = obterTurnoOperador(op, shifts, 'Não Definido');
        contagemOpsTurno[turno] = (contagemOpsTurno[turno] || 0) + 1;
      });

      const realizadoDashTurno: Record<string, number> = {};
      const setUnicoDashTurno = new Set<string>();

      invValido.forEach((item) => {
        if (!item.data) return;
        const dbData = parseBRDate(item.data);
        let passa = false;
        if (filtroEsperadoPeriodo === 'tudo') passa = true;
        else if (filtroEsperadoPeriodo === 'hoje')
          passa = dbData.getTime() === hojeEsperado.getTime();
        else if (filtroEsperadoPeriodo === '7dias')
          passa = (hojeEsperado.getTime() - dbData.getTime()) / 86400000 <= 7;
        else if (filtroEsperadoPeriodo === '30dias')
          passa = (hojeEsperado.getTime() - dbData.getTime()) / 86400000 <= 30;
        else if (filtroEsperadoPeriodo === 'mes')
          passa =
            dbData.getMonth() === hojeEsperado.getMonth() &&
            dbData.getFullYear() === hojeEsperado.getFullYear();

        if (passa && item.operador) {
          const dataLimpa = formatarDataPadrao(item.data);
          const opLimpo = String(item.operador).trim().toLowerCase();
          const chave = `${opLimpo}-${dataLimpa}-${item.endereco}`;
          if (!setUnicoDashTurno.has(chave)) {
            setUnicoDashTurno.add(chave);
            const turno = obterTurnoOperador(item.operador, shifts, 'Não Definido');
            realizadoDashTurno[turno] = (realizadoDashTurno[turno] || 0) + 1;
          }
        }
      });

      const turnosLabels = Object.keys(contagemOpsTurno).sort();
      const dadosEsperado = turnosLabels.map(
        (t) => (contagemOpsTurno[t] || 0) * 2 * numDiasEsperado
      );
      const dadosRealizado = turnosLabels.map((t) => realizadoDashTurno[t] || 0);

      const totalEsperadoGeral = dadosEsperado.reduce((a, b) => a + b, 0);
      const totalRealizadoGeral = dadosRealizado.reduce((a, b) => a + b, 0);

      if (metricasSpanRef.current) {
        const corRealizado =
          totalRealizadoGeral >= totalEsperadoGeral
            ? 'var(--success-color)'
            : 'var(--danger-color)';
        metricasSpanRef.current.innerHTML = `Total Esperado: ${totalEsperadoGeral} | Total Realizado: <span style="color: ${corRealizado};">${totalRealizadoGeral}</span>`;
      }

      instances.push(
        new Chart(esperadoRealizadoRef.current, {
          type: 'bar',
          data: {
            labels: turnosLabels,
            datasets: [
              {
                label: 'Meta (Esperado)',
                data: dadosEsperado,
                backgroundColor: '#e67e22',
                borderRadius: 4,
                // rotulo com o valor em cima das colunas laranjas (igual ao das azuis)
                datalabels: {
                  display: true,
                  color: textColor,
                  font: { weight: 'bold' },
                  anchor: 'end',
                  align: 'top',
                  offset: 2,
                  clamp: true,
                  clip: false,
                  formatter: (v: number) => (v > 0 ? v : ''),
                },
              },
              {
                label: 'Contagem (Realizado)',
                data: dadosRealizado,
                backgroundColor: '#3498db',
                borderRadius: 4,
                datalabels: {
                  display: true,
                  color: textColor,
                  font: { weight: 'bold' },
                  anchor: 'end',
                  align: 'top',
                  offset: 2,
                  clamp: true,
                  clip: false,
                  formatter: (v: number) => (v > 0 ? v : ''),
                },
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 20 } },
            plugins: {
              legend: { display: true, labels: { color: textColor } },
              datalabels: {
                color: textColor,
                font: { weight: 'bold' },
                anchor: 'end',
                align: 'top',
                offset: 2,
                formatter: (v: number) => (v > 0 ? v : ''),
              },
            },
            scales: {
              x: { ticks: { color: textColor, font: { weight: 'bold' } } },
              y: { grace: '10%', ticks: { color: textColor, stepSize: 2 } },
            },
          },
        })
      );
    }

    return () => {
      instances.forEach((c) => c.destroy());
    };
  }, [
    inventario,
    enderecos,
    operators,
    shifts,
    isDark,
    filtroContagensPeriodo,
    contagensDataIni,
    contagensDataFim,
    filtroEsperadoPeriodo,
  ]);

  return (
    <div className="charts-grid">
      {/* grafico de contagens por dia com filtro de periodo */}
      <div
        className="card chart-container"
        style={{
          height: '400px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            marginBottom: '10px',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <h3 style={{ marginBottom: 0 }}>Contagens por Dia (Geral)</h3>

          <div
            style={{
              display: 'flex',
              gap: '20px',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: '15px',
                fontSize: '0.85rem',
                fontWeight: 'bold',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <div
                  style={{
                    width: '25px',
                    height: '10px',
                    backgroundColor: '#e67e22',
                    borderRadius: '2px',
                  }}
                />
                <span>Total Bipado no Dia</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <div
                  style={{
                    width: '25px',
                    height: '0px',
                    borderTop: '2px dashed #2ecc71',
                  }}
                />
                <span>Meta Diária (71)</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <select
                id="filtro-contagens-periodo"
                value={filtroContagensPeriodo}
                onChange={(e) => onChangeFiltroContagens(e.target.value)}
                style={{
                  padding: '6px',
                  borderRadius: '5px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-color)',
                  color: 'var(--text-color)',
                  outline: 'none',
                  fontWeight: 'bold',
                  fontSize: '0.8rem',
                }}
              >
                <option value="tudo">Desde o Início</option>
                <option value="hoje">Hoje</option>
                <option value="7dias">Últimos 7 Dias</option>
                <option value="30dias">Últimos 30 Dias</option>
                <option value="mes">Este Mês</option>
                <option value="personalizado">Personalizado</option>
              </select>

              {filtroContagensPeriodo === 'personalizado' && (
                <div
                  style={{
                    display: 'flex',
                    gap: '5px',
                    alignItems: 'center',
                    fontSize: '0.8rem',
                  }}
                >
                  <input
                    type="date"
                    value={contagensDataIni}
                    onChange={(e) => onChangeDataIni(e.target.value)}
                    style={{
                      padding: '4px',
                      borderRadius: '5px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-color)',
                      color: 'var(--text-color)',
                      outline: 'none',
                    }}
                  />
                  <span>até</span>
                  <input
                    type="date"
                    value={contagensDataFim}
                    onChange={(e) => onChangeDataFim(e.target.value)}
                    style={{
                      padding: '4px',
                      borderRadius: '5px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-color)',
                      color: 'var(--text-color)',
                      outline: 'none',
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        <div style={{ position: 'relative', width: '100%', flex: 1 }}>
          <canvas ref={contagensDiaRef} />
        </div>
      </div>

      {/* grafico top 10 operadores */}
      <div className="card chart-container">
        <h3>Top 10: Produtividade Total (Operadores)</h3>
        <div style={{ position: 'relative', width: '100%', flex: 1 }}>
          <canvas ref={contagensDiaOpRef} />
        </div>
      </div>

      {/* grafico esperado x realizado por turno */}
      <div className="card chart-container full-width" style={{ height: '450px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            marginBottom: '10px',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div>
            <h3 style={{ marginBottom: '5px' }}>
              <i
                className="fa-solid fa-scale-balanced"
                style={{ color: 'var(--primary-color)' }}
              />{' '}
              Esperado x Realizado por Turno
            </h3>
            <span
              ref={metricasSpanRef}
              style={{
                fontSize: '0.95rem',
                fontWeight: 'bold',
                color: 'var(--warning-color)',
              }}
            >
              Carregando métricas...
            </span>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <select
              id="filtro-esperado-periodo"
              value={filtroEsperadoPeriodo}
              onChange={(e) => onChangeFiltroEsperado(e.target.value)}
              style={{
                padding: '6px',
                borderRadius: '5px',
                border: '1px solid var(--border)',
                background: 'var(--bg-color)',
                color: 'var(--text-color)',
                outline: 'none',
                fontWeight: 'bold',
                fontSize: '0.8rem',
              }}
            >
              <option value="hoje">Hoje</option>
              <option value="7dias">Últimos 7 Dias</option>
              <option value="30dias">Últimos 30 Dias</option>
              <option value="mes">Este Mês</option>
              <option value="tudo">Desde o Início</option>
            </select>
          </div>
        </div>

        <div style={{ position: 'relative', width: '100%', flex: 1 }}>
          <canvas ref={esperadoRealizadoRef} />
        </div>
      </div>
    </div>
  );
};

interface RelatoriosChartsProps {
  inventario: InventoryRecord[];
  enderecos: string[];
  enderecosStatus: Record<string, string>;
  enderecosGalpao: Record<string, string>;
  shifts: Record<string, string>;
  isDark: boolean;
  filtroGalpaoPeriodo: string;
  galpaoDataIni: string;
  galpaoDataFim: string;
  onChangeFiltroGalpao: (val: string) => void;
  onChangeGalpaoDataIni: (val: string) => void;
  onChangeGalpaoDataFim: (val: string) => void;
}

export const RelatoriosCharts: React.FC<RelatoriosChartsProps> = ({
  inventario,
  enderecos,
  enderecosStatus,
  enderecosGalpao,
  shifts,
  isDark,
  filtroGalpaoPeriodo,
  galpaoDataIni,
  galpaoDataFim,
  onChangeFiltroGalpao,
  onChangeGalpaoDataIni,
  onChangeGalpaoDataFim,
}) => {
  const enderecosOpRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperEndOpRef = useRef<HTMLDivElement | null>(null);
  const statusEndRef = useRef<HTMLCanvasElement | null>(null);
  const divergenciaRef = useRef<HTMLCanvasElement | null>(null);
  const prodDivRef = useRef<HTMLCanvasElement | null>(null);
  const galpaoPizzaRef = useRef<HTMLCanvasElement | null>(null);
  const turnosPizzaRef = useRef<HTMLCanvasElement | null>(null);
  const galpaoDiaRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const invValido = inventario.filter((i) => enderecos.includes(i.endereco));
    const textColor = isDark ? '#fff' : '#333';

    const enderecosPorOperador: Record<string, Set<string>> = {};
    invValido.forEach((item) => {
      if (!enderecosPorOperador[item.operador]) enderecosPorOperador[item.operador] = new Set();
      enderecosPorOperador[item.operador].add(item.endereco);
    });

    const contagemEnderecosOp: Record<string, number> = {};
    for (const op in enderecosPorOperador) {
      contagemEnderecosOp[op] = enderecosPorOperador[op].size;
    }

    let conc = 0;
    let andamento = 0;
    let nao = 0;
    enderecos.forEach((endereco) => {
      const status = enderecosStatus[endereco];
      if (status === 'concluido') conc++;
      else if (status === 'em-andamento') andamento++;
      else nao++;
    });

    const instances: Chart[] = [];

    // barras horizontais de enderecos por operador
    const operadoresOrdenadosEnd = Object.keys(contagemEnderecosOp).sort(
      (a, b) => contagemEnderecosOp[b] - contagemEnderecosOp[a]
    );
    const valoresOrdenadosEnd = operadoresOrdenadosEnd.map((op) => contagemEnderecosOp[op]);

    if (enderecosOpRef.current && wrapperEndOpRef.current) {
      const alturaIdeal = Math.max(300, operadoresOrdenadosEnd.length * 35);
      wrapperEndOpRef.current.style.height = `${alturaIdeal}px`;

      instances.push(
        new Chart(enderecosOpRef.current, {
          type: 'bar',
          data: {
            labels: operadoresOrdenadosEnd,
            datasets: [
              {
                label: 'Endereços Contados',
                data: valoresOrdenadosEnd,
                backgroundColor: '#8e44ad',
                borderWidth: 0,
                borderRadius: 4,
              },
            ],
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { right: 30 } },
            plugins: {
              legend: { display: false },
              datalabels: {
                display: true,
                color: textColor,
                font: { weight: 'bold', size: 11 },
                anchor: 'end',
                align: 'right',
                formatter: (value: number) => (value > 0 ? value : ''),
              },
            },
            scales: {
              x: { grid: { display: false }, ticks: { color: textColor } },
              y: {
                grid: { display: false },
                ticks: { color: textColor, font: { weight: 'bold' } },
              },
            },
          },
        })
      );
    }

    // rosca do status dos enderecos
    if (statusEndRef.current) {
      instances.push(
        new Chart(statusEndRef.current, {
          type: 'doughnut',
          data: {
            labels: ['Concluídos', 'Em Andamento', 'Não Iniciados'],
            datasets: [
              {
                data: [conc, andamento, nao],
                backgroundColor: ['#2ecc71', '#f1c40f', '#e74c3c'],
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { labels: { color: textColor } },
              datalabels: {
                color: '#fff',
                font: { weight: 'bold' },
                formatter: (v: number) => (v > 0 ? v : ''),
              },
            },
          },
        })
      );
    }

    // pizza de qualidade ok vs divergencia
    const qtdDivergencias = new Set(
      invValido
        .filter((i) => i.produto !== '' || i.quantidade !== '')
        .map((i) => i.endereco)
    ).size;
    const qtdTotaisContados = new Set(invValido.map((i) => i.endereco)).size;
    const qtdOk = qtdTotaisContados > 0 ? qtdTotaisContados - qtdDivergencias : 0;

    if (divergenciaRef.current) {
      instances.push(
        new Chart(divergenciaRef.current, {
          type: 'pie',
          data: {
            labels: ['Endereços OK', 'Com Divergência'],
            datasets: [
              {
                data: [qtdOk, qtdDivergencias],
                backgroundColor: ['#3498db', '#e74c3c'],
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { labels: { color: textColor } },
              datalabels: {
                color: '#fff',
                font: { weight: 'bold' },
                formatter: (v: number) => (v > 0 ? v : ''),
              },
            },
          },
        })
      );
    }

    // top produtos que deram divergencia
    const contagemProdutosDiv: Record<string, number> = {};
    invValido.forEach((item) => {
      if (item.produto && item.produto.trim() !== '') {
        contagemProdutosDiv[item.produto] = (contagemProdutosDiv[item.produto] || 0) + 1;
      }
    });
    const topProdutosDiv = Object.keys(contagemProdutosDiv)
      .sort((a, b) => contagemProdutosDiv[b] - contagemProdutosDiv[a])
      .slice(0, 10);
    const valoresProdutosDiv = topProdutosDiv.map((prod) => contagemProdutosDiv[prod]);

    if (prodDivRef.current) {
      instances.push(
        new Chart(prodDivRef.current, {
          type: 'bar',
          data: {
            labels: topProdutosDiv,
            datasets: [
              {
                label: 'Divergências:',
                data: valoresProdutosDiv,
                backgroundColor: '#f39c12',
                borderWidth: 1,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 30 } },
            plugins: {
              legend: { display: false },
              datalabels: {
                color: textColor,
                font: { weight: 'bold' },
                anchor: 'end',
                align: 'top',
                formatter: (v: number) => (v > 0 ? v : ''),
              },
            },
            scales: {
              x: { ticks: { color: textColor } },
              y: { grace: '10%', ticks: { color: textColor, stepSize: 1 } },
            },
          },
        })
      );
    }

    // filtro de data pra galpao e turnos
    const hojeGalpao = new Date();
    hojeGalpao.setHours(0, 0, 0, 0);

    const invValidoGalpoes = invValido.filter((item) => {
      if (!item.data) return false;
      const dbData = parseBRDate(item.data);
      if (filtroGalpaoPeriodo === 'tudo') return true;
      if (filtroGalpaoPeriodo === 'hoje') return dbData.getTime() === hojeGalpao.getTime();
      if (filtroGalpaoPeriodo === '7dias')
        return (hojeGalpao.getTime() - dbData.getTime()) / 86400000 <= 7;
      if (filtroGalpaoPeriodo === '30dias')
        return (hojeGalpao.getTime() - dbData.getTime()) / 86400000 <= 30;
      if (filtroGalpaoPeriodo === 'mes')
        return (
          dbData.getMonth() === hojeGalpao.getMonth() &&
          dbData.getFullYear() === hojeGalpao.getFullYear()
        );
      if (filtroGalpaoPeriodo === 'personalizado') {
        if (!galpaoDataIni || !galpaoDataFim) return true;
        const dIni = new Date(galpaoDataIni + 'T00:00:00').getTime();
        const dFim = new Date(galpaoDataFim + 'T23:59:59').getTime();
        return dbData.getTime() >= dIni && dbData.getTime() <= dFim;
      }
      return true;
    });

    const contagemGalpaoDia: Record<string, Record<string, number>> = {};
    const contagemTotalGalpao: Record<string, number> = {};
    const setDiasGalpao = new Set<string>();

    invValidoGalpoes.forEach((item) => {
      const dataLimpa = formatarDataPadrao(item.data);
      setDiasGalpao.add(dataLimpa);
      const galpao = enderecosGalpao[item.endereco] || 'Outros';
      if (!contagemGalpaoDia[galpao]) contagemGalpaoDia[galpao] = {};
      contagemGalpaoDia[galpao][dataLimpa] =
        (contagemGalpaoDia[galpao][dataLimpa] || 0) + 1;
      contagemTotalGalpao[galpao] = (contagemTotalGalpao[galpao] || 0) + 1;
    });

    const diasUnicosGalpao = Array.from(setDiasGalpao).sort(
      (a, b) => converterParaDataNumero(a) - converterParaDataNumero(b)
    );
    const galpoesUnicos = Object.keys(contagemGalpaoDia).sort();
    const paletaGalpoes = [
      '#3498db',
      '#e74c3c',
      '#2ecc71',
      '#9b59b6',
      '#f1c40f',
      '#e67e22',
      '#1abc9c',
      '#34495e',
      '#ff9800',
      '#795548',
    ];

    // participacao por galpao em %
    const labelsGalpaoPizza = Object.keys(contagemTotalGalpao);
    const dadosGalpaoPizza = labelsGalpaoPizza.map((g) => contagemTotalGalpao[g]);

    if (galpaoPizzaRef.current) {
      instances.push(
        new Chart(galpaoPizzaRef.current, {
          type: 'pie',
          data: {
            labels: labelsGalpaoPizza,
            datasets: [
              {
                data: dadosGalpaoPizza,
                backgroundColor: paletaGalpoes,
                borderWidth: 1,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { labels: { color: textColor } },
              datalabels: {
                display: true,
                color: '#ffffff',
                font: { weight: 'bold', size: 13 },
                formatter: (value: number, ctx) => {
                  if (value === 0) return '';
                  const dataArr = ctx.dataset.data as number[];
                  const sum = dataArr.reduce((a, b) => a + b, 0);
                  return sum > 0 ? ((value * 100) / sum).toFixed(1) + '%' : '';
                },
              },
            },
          },
        })
      );
    }

    // produtividade por turno em %
    const contagemTurno: Record<string, number> = {};
    const setDiasTurno = new Set<string>();

    invValidoGalpoes.forEach((item) => {
      const dataLimpa = formatarDataPadrao(item.data);
      const opLimpo = String(item.operador || '').trim().toLowerCase();
      const chaveUnica = `${opLimpo}-${dataLimpa}-${item.endereco}`;
      if (!setDiasTurno.has(chaveUnica)) {
        setDiasTurno.add(chaveUnica);
        const turno = obterTurnoOperador(item.operador, shifts, 'Outros');
        contagemTurno[turno] = (contagemTurno[turno] || 0) + 1;
      }
    });

    const labelsTurnoPizza = Object.keys(contagemTurno).sort();
    const dadosTurnoPizza = labelsTurnoPizza.map((t) => contagemTurno[t]);
    const paletaTurnos = ['#f39c12', '#8e44ad', '#2980b9', '#27ae60', '#c0392b'];

    if (turnosPizzaRef.current) {
      instances.push(
        new Chart(turnosPizzaRef.current, {
          type: 'pie',
          data: {
            labels: labelsTurnoPizza,
            datasets: [
              {
                data: dadosTurnoPizza,
                backgroundColor: paletaTurnos,
                borderWidth: 1,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { labels: { color: textColor } },
              datalabels: {
                display: true,
                color: '#ffffff',
                font: { weight: 'bold', size: 13 },
                formatter: (value: number, ctx) => {
                  if (value === 0) return '';
                  const dataArr = ctx.dataset.data as number[];
                  const sum = dataArr.reduce((a, b) => a + b, 0);
                  return sum > 0 ? ((value * 100) / sum).toFixed(1) + '%' : '';
                },
              },
            },
          },
        })
      );
    }

    // linha de produtividade diaria por galpao
    if (galpaoDiaRef.current) {
      const datasetsGalpao = galpoesUnicos.map((galpao, index) => ({
        label: `Galpão: ${galpao}`,
        data: diasUnicosGalpao.map((dia) => contagemGalpaoDia[galpao][dia] || 0),
        borderColor: paletaGalpoes[index % paletaGalpoes.length],
        backgroundColor: paletaGalpoes[index % paletaGalpoes.length],
        fill: false,
        tension: 0.2,
        borderWidth: 3,
      }));

      instances.push(
        new Chart(galpaoDiaRef.current, {
          type: 'line',
          data: { labels: diasUnicosGalpao, datasets: datasetsGalpao },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 30 } },
            plugins: {
              legend: { labels: { color: textColor } },
              datalabels: {
                display: true,
                color: textColor,
                font: { weight: 'bold' },
                formatter: (v: number) => (v > 0 ? v : ''),
              },
            },
            scales: {
              x: { ticks: { color: textColor } },
              y: { grace: '10%', ticks: { color: textColor, stepSize: 1 } },
            },
          },
        })
      );
    }

    return () => {
      instances.forEach((c) => c.destroy());
    };
  }, [
    inventario,
    enderecos,
    enderecosStatus,
    enderecosGalpao,
    shifts,
    isDark,
    filtroGalpaoPeriodo,
    galpaoDataIni,
    galpaoDataFim,
  ]);

  return (
    <div className="charts-grid">
      {/* barras horizontais de enderecos por operador */}
      <div
        className="card full-width"
        style={{ display: 'flex', flexDirection: 'column', height: '450px' }}
      >
        <h3 style={{ marginBottom: '15px', flexShrink: 0 }}>Endereços por Operador</h3>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            paddingRight: '10px',
          }}
        >
          <div ref={wrapperEndOpRef} style={{ position: 'relative', width: '100%' }}>
            <canvas ref={enderecosOpRef} />
          </div>
        </div>
      </div>

      {/* rosca do status dos enderecos */}
      <div className="card chart-container">
        <h3>Status dos Endereços</h3>
        <div style={{ position: 'relative', width: '100%', flex: 1 }}>
          <canvas ref={statusEndRef} />
        </div>
      </div>

      {/* pizza de qualidade ok vs divergencia */}
      <div className="card chart-container">
        <h3>Qualidade (OK vs Divergência)</h3>
        <div style={{ position: 'relative', width: '100%', flex: 1 }}>
          <canvas ref={divergenciaRef} />
        </div>
      </div>

      {/* barras dos top produtos com divergencia */}
      <div className="card chart-container">
        <h3>Top Produtos com Divergência</h3>
        <div style={{ position: 'relative', width: '100%', flex: 1 }}>
          <canvas ref={prodDivRef} />
        </div>
      </div>

      {/* pizza de participacao por galpao */}
      <div className="card chart-container">
        <h3>Participação por Galpão (%)</h3>
        <div style={{ position: 'relative', width: '100%', flex: 1 }}>
          <canvas ref={galpaoPizzaRef} />
        </div>
      </div>

      {/* pizza de produtividade por turno */}
      <div className="card chart-container">
        <h3>Produtividade por Turno (%)</h3>
        <div style={{ position: 'relative', width: '100%', flex: 1 }}>
          <canvas ref={turnosPizzaRef} />
        </div>
      </div>

      {/* linha de produtividade diaria por galpao */}
      <div className="card chart-container full-width" style={{ height: '450px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            marginBottom: '10px',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <h3 style={{ marginBottom: 0 }}>Produtividade Diária por Galpão</h3>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <select
              id="filtro-galpao-periodo"
              value={filtroGalpaoPeriodo}
              onChange={(e) => onChangeFiltroGalpao(e.target.value)}
              style={{
                padding: '6px',
                borderRadius: '5px',
                border: '1px solid var(--border)',
                background: 'var(--bg-color)',
                color: 'var(--text-color)',
                outline: 'none',
                fontWeight: 'bold',
              }}
            >
              <option value="tudo">Desde o Início</option>
              <option value="hoje">Hoje</option>
              <option value="7dias">Últimos 7 Dias</option>
              <option value="30dias">Últimos 30 Dias</option>
              <option value="mes">Este Mês</option>
              <option value="personalizado">Personalizado</option>
            </select>

            {filtroGalpaoPeriodo === 'personalizado' && (
              <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                <input
                  type="date"
                  value={galpaoDataIni}
                  onChange={(e) => onChangeGalpaoDataIni(e.target.value)}
                  style={{
                    padding: '5px',
                    borderRadius: '5px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    outline: 'none',
                  }}
                />
                <span>até</span>
                <input
                  type="date"
                  value={galpaoDataFim}
                  onChange={(e) => onChangeGalpaoDataFim(e.target.value)}
                  style={{
                    padding: '5px',
                    borderRadius: '5px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    outline: 'none',
                  }}
                />
              </div>
            )}
          </div>
        </div>
        <div style={{ position: 'relative', width: '100%', flex: 1 }}>
          <canvas ref={galpaoDiaRef} />
        </div>
      </div>
    </div>
  );
};
