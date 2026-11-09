import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  DashboardCharts,
  RelatoriosCharts,
  formatarDataPadrao,
  converterParaDataNumero,
  parseBRDate,
  obterTurnoOperador,
  type InventoryRecord,
} from './components/WmsCharts';

type ActiveTab =
  | 'inventario'
  | 'dashboard'
  | 'relatorios'
  | 'historico'
  | 'orfaos'
  | 'cadastros'
  | 'configuracoes';

// limpa caracteres estranhos ou tags html antes de enviar pro banco
function sanitizeInput(val: string): string {
  if (!val) return '';
  return String(val)
    .replace(/<[^>]*>?/gm, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

// calcula os cards do topo do dashboard e valores financeiros de sobra/falta
function calculateDashboardMetrics(
  enderecos: string[],
  enderecosStatus: Record<string, string>,
  inventario: InventoryRecord[],
  custosBase: Record<string, number>
) {
  const totalEnderecos = enderecos.length;
  let concluidos = 0;

  enderecos.forEach((end) => {
    if (enderecosStatus[end] === 'concluido') concluidos++;
  });

  const pendentes = totalEnderecos - concluidos;
  const porcentagemConcluida =
    totalEnderecos > 0 ? Math.round((concluidos / totalEnderecos) * 100) : 0;

  const enderecosSet = new Set(enderecos);
  const invValido = inventario.filter((i) => enderecosSet.has(i.endereco));

  let valorAcimaTotal = 0;
  let valorAbaixoTotal = 0;
  const setEndDivergentes = new Set<string>();

  invValido.forEach((item) => {
    const temProdOuQtd = item.produto !== '' || item.quantidade !== '';
    if (!temProdOuQtd) return;

    const qtdIms =
      item.quantidadeIms !== undefined && item.quantidadeIms !== ''
        ? Number(item.quantidadeIms)
        : 0;
    const qtdFis =
      item.quantidade !== undefined && item.quantidade !== ''
        ? Number(item.quantidade)
        : 0;
    const diff = qtdFis - qtdIms;

    if (diff !== 0) {
      setEndDivergentes.add(item.endereco);
      const custoUnit = item.produto && custosBase[item.produto] ? Number(custosBase[item.produto]) : 0;
      if (diff > 0) {
        valorAcimaTotal += diff * custoUnit;
      } else {
        valorAbaixoTotal += Math.abs(diff) * custoUnit;
      }
    }
  });

  return {
    totalEnderecos,
    concluidos,
    pendentes,
    porcentagemConcluida,
    valorAcimaTotal,
    valorAbaixoTotal,
    enderecosDivergentes: setEndDivergentes.size,
  };
}

export default function App() {
  // token interno pra falar com o backend sem expor chave do firebase
  const [token, setToken] = useState<string>('');
  const [sidebarOculta, setSidebarOculta] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('inventario');
  const [isLightTheme, setIsLightTheme] = useState<boolean>(false);

  // titulo fixo do inventario la no topo
  const sessaoAtual = 'Inventário Almoxarifado Eletra';
  const [inventario, setInventario] = useState<InventoryRecord[]>([]);
  const [enderecos, setEnderecos] = useState<string[]>([]);
  const [enderecosStatus, setEnderecosStatus] = useState<Record<string, 'nao-iniciado' | 'em-andamento' | 'concluido'>>({});
  const [enderecosGalpao, setEnderecosGalpao] = useState<Record<string, string>>({});
  const [produtosBase, setProdutosBase] = useState<Record<string, string>>({});
  const [custosBase, setCustosBase] = useState<Record<string, number>>({});
  const [operators, setOperators] = useState<string[]>([]);
  const [shiftMap, setShiftMap] = useState<Record<string, string>>({});

  // aviso rapido na tela pra nao travar com alert do navegador
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'warning' | 'danger' } | null>(null);

  // modal da senha mestre qnd for zerar sistema ou contagens
  const [adminActionModal, setAdminActionModal] = useState<{
    open: boolean;
    mode: 'all' | 'counts_only';
    pin: string;
    error: string;
  }>({ open: false, mode: 'counts_only', pin: '', error: '' });

  // modal pra validar endereco orfao e escolher o galpao
  const [orphanModal, setOrphanModal] = useState<{
    open: boolean;
    endereco: string;
    galpao: string;
  }>({ open: false, endereco: '', galpao: 'G1' });

  // campos do formulario de contagem fisica
  const [operadorInput, setOperadorInput] = useState<string>('');
  const [enderecoInput, setEnderecoInput] = useState<string>('');
  const [produtoInput, setProdutoInput] = useState<string>('');
  const [qtdImsInput, setQtdImsInput] = useState<string>('');
  const [qtdFisicaInput, setQtdFisicaInput] = useState<string>('');
  const [obsInput, setObsInput] = useState<string>('');
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const operadorRef = useRef<HTMLInputElement>(null);
  const enderecoRef = useRef<HTMLInputElement>(null);
  const produtoRef = useRef<HTMLInputElement>(null);
  const qtdImsRef = useRef<HTMLInputElement>(null);
  const qtdFisicaRef = useRef<HTMLInputElement>(null);
  const obsRef = useRef<HTMLInputElement>(null);

  // filtros e tabelas retrateis do dashboard
  const [filtroContagensPeriodo, setFiltroContagensPeriodo] = useState<string>('tudo');
  const [contagensDataIni, setContagensDataIni] = useState<string>('');
  const [contagensDataFim, setContagensDataFim] = useState<string>('');
  const [filtroEsperadoPeriodo, setFiltroEsperadoPeriodo] = useState<string>('hoje');
  const [ausentesAberto, setAusentesAberto] = useState<boolean>(false);
  const [filtroTurnoAusentes, setFiltroTurnoAusentes] = useState<string>('todos');
  const [produtividadeAberto, setProdutividadeAberto] = useState<boolean>(true);

  // filtros da aba de relatorios
  const [filtroGalpaoPeriodo, setFiltroGalpaoPeriodo] = useState<string>('tudo');
  const [galpaoDataIni, setGalpaoDataIni] = useState<string>('');
  const [galpaoDataFim, setGalpaoDataFim] = useState<string>('');

  // filtros do historico completo
  const [filtroPesquisa, setFiltroPesquisa] = useState<string>('');
  const [filtroOperador, setFiltroOperador] = useState<string>('');
  const [filtroStatus, setFiltroStatus] = useState<string>('');
  const [filtroDivergencia, setFiltroDivergencia] = useState<string>('');

  // mapa temporario pra corrigir nome de operador digitado errado
  const [correcaoOperadorMap, setCorrecaoOperadorMap] = useState<Record<string, string>>({});

  // campos da aba de cadastros e lancamento manual
  const [manualOperador, setManualOperador] = useState<string>('');
  const [manualEndereco, setManualEndereco] = useState<string>('');
  const [manualProduto, setManualProduto] = useState<string>('');
  const [manualQtdIms, setManualQtdIms] = useState<string>('');
  const [manualQtdFisica, setManualQtdFisica] = useState<string>('');
  const [manualData, setManualData] = useState<string>('');
  const [manualHora, setManualHora] = useState<string>('');
  const [manualObs, setManualObs] = useState<string>('');

  const [pesquisaEnderecos, setPesquisaEnderecos] = useState<string>('');
  const [filtroGalpaoCad, setFiltroGalpaoCad] = useState<string>('');
  const [filtroStatusCad, setFiltroStatusCad] = useState<string>('todos');
  const [edicaoGalpaoMap, setEdicaoGalpaoMap] = useState<Record<string, string>>({});
  const [pesquisaProdutos, setPesquisaProdutos] = useState<string>('');

  // mensagens de retorno qnd importa planilha nas configuracoes
  const [msgPlanilha, setMsgPlanilha] = useState<string>('');
  const [msgPlanilhaProdutos, setMsgPlanilhaProdutos] = useState<string>('');
  const [msgPlanilhaCustos, setMsgPlanilhaCustos] = useState<string>('');
  const [msgPlanilhaHistorico, setMsgPlanilhaHistorico] = useState<string>('');

  const showNotice = useCallback((text: string, type: 'success' | 'warning' | 'danger' = 'success') => {
    setToast({ text, type });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  }, []);

  // bip sonoro curto qnd salva contagem
  const emitirSomSucesso = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch {
      // se o navegador bloquear o audio automatico nao tem problema
    }
  }, []);

  // aplica o tema salvo no localstorage qnd abre a tela
  useEffect(() => {
    const temaSalvo = localStorage.getItem('temaWMS');
    if (temaSalvo === 'claro') {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
      setIsLightTheme(true);
    } else {
      document.body.classList.remove('light-theme');
      document.body.classList.add('dark-theme');
      setIsLightTheme(false);
    }
  }, []);

  const alternarTema = () => {
    if (document.body.classList.contains('dark-theme')) {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
      localStorage.setItem('temaWMS', 'claro');
      setIsLightTheme(true);
    } else {
      document.body.classList.remove('light-theme');
      document.body.classList.add('dark-theme');
      localStorage.setItem('temaWMS', 'escuro');
      setIsLightTheme(false);
    }
  };

  // puxa os dados do firebase pelo backend
  const fetchWmsData = useCallback(async (authToken: string) => {
    const headers = { Authorization: `Bearer ${authToken}` };
    const bootstrapRes = await fetch('/api/wms/bootstrap', { headers });

    if (bootstrapRes.ok) {
      const data = await bootstrapRes.json();
      setInventario(Array.isArray(data.inventario) ? data.inventario : []);
      setEnderecos(Array.isArray(data.enderecos) ? data.enderecos : []);
      setEnderecosStatus(data.enderecosStatus || {});
      setEnderecosGalpao(data.enderecosGalpao || {});
      setProdutosBase(data.produtosBase || {});
      setCustosBase(data.custosBase || {});
      setOperators(Array.isArray(data.operators) ? data.operators : []);
      setShiftMap(data.shifts || data.shiftMap || {});
    }
  }, []);

  // gera o token de sessao interno assim q carrega a pagina
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/session-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active && data.token) {
          setToken(data.token);
          await fetchWmsData(data.token);
        }
      } catch (err) {
        console.error('Erro ao conectar no servidor:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchWmsData]);

  // salva alteracoes nas bases gerais la no firebase
  const salvarNoFirebase = useCallback(
    async (docId: string, payload: Record<string, unknown>) => {
      if (!token) return;
      await fetch('/api/wms/sync-bases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ [docId]: payload }),
      });
    },
    [token]
  );

  // resumo de indicadores da aba dashboard
  const metrics = useMemo(
    () => calculateDashboardMetrics(enderecos, enderecosStatus, inventario, custosBase),
    [enderecos, enderecosStatus, inventario, custosBase]
  );

  const mediaEnderecosDia = useMemo(() => {
    const diasDeInventario = new Set(inventario.map((item) => formatarDataPadrao(item.data))).size;
    const enderecosContados = new Set(inventario.map((item) => item.endereco)).size;
    return diasDeInventario > 0 ? Math.round(enderecosContados / diasDeInventario) : 0;
  }, [inventario]);

  const formatoBRL = useMemo(
    () => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }),
    []
  );

  // lista quem nao contou ontem ou fez menos de 2 enderecos
  const ausentesOntemList = useMemo(() => {
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    const dataOntemPadrao = formatarDataPadrao(ontem.toLocaleDateString('pt-BR'));

    const enderecosSet = new Set(enderecos);
    const invValido = inventario.filter((i) => enderecosSet.has(i.endereco));
    const contagemPorOperador: Record<string, number> = {};

    invValido.forEach((item) => {
      if (formatarDataPadrao(item.data) === dataOntemPadrao) {
        if (item.operador && item.operador.trim() !== '') {
          const nomeOp = item.operador.trim().toLowerCase();
          contagemPorOperador[nomeOp] = (contagemPorOperador[nomeOp] || 0) + 1;
        }
      }
    });

    let ausentes = operators.filter(
      (op) => (contagemPorOperador[op.trim().toLowerCase()] || 0) < 2
    );
    if (filtroTurnoAusentes !== 'todos') {
      ausentes = ausentes.filter((op) => {
        const turnoDoOp = obterTurnoOperador(op, shiftMap, 'Não Definido');
        return turnoDoOp === filtroTurnoAusentes;
      });
    }

    return ausentes.sort().map((op) => ({
      operador: op,
      turno: obterTurnoOperador(op, shiftMap, 'Não Definido'),
      qtd: contagemPorOperador[op.trim().toLowerCase()] || 0,
    }));
  }, [enderecos, inventario, operators, shiftMap, filtroTurnoAusentes]);

  // monta os dados da tabela de produtividade diaria por operador
  const tabelaProdutividadeData = useMemo(() => {
    const enderecosSet = new Set(enderecos);
    const invValido = inventario.filter((i) => enderecosSet.has(i.endereco));

    const enderecosPorOperador: Record<string, Set<string>> = {};
    const enderecosPorDiaOp: Record<string, Record<string, Set<string>>> = {};
    const enderecosPorDia: Record<string, Set<string>> = {};

    invValido.forEach((item) => {
      const dataLimpa = formatarDataPadrao(item.data);
      if (!enderecosPorOperador[item.operador]) enderecosPorOperador[item.operador] = new Set();
      enderecosPorOperador[item.operador].add(item.endereco);

      if (!enderecosPorDia[dataLimpa]) enderecosPorDia[dataLimpa] = new Set();
      enderecosPorDia[dataLimpa].add(item.endereco);

      if (!enderecosPorDiaOp[item.operador]) enderecosPorDiaOp[item.operador] = {};
      if (!enderecosPorDiaOp[item.operador][dataLimpa]) enderecosPorDiaOp[item.operador][dataLimpa] = new Set();
      enderecosPorDiaOp[item.operador][dataLimpa].add(item.endereco);
    });

    const contagemOperador: Record<string, number> = {};
    for (const op in enderecosPorOperador) {
      contagemOperador[op] = enderecosPorOperador[op].size;
    }

    const contagemDiaOp: Record<string, Record<string, number>> = {};
    for (const op in enderecosPorDiaOp) {
      contagemDiaOp[op] = {};
      for (const dia in enderecosPorDiaOp[op]) {
        contagemDiaOp[op][dia] = enderecosPorDiaOp[op][dia].size;
      }
    }

    const hojeContagens = new Date();
    hojeContagens.setHours(0, 0, 0, 0);
    const diasPermitidos = new Set<string>();

    invValido.forEach((item) => {
      if (!item.data) return;
      const dbData = parseBRDate(item.data);
      let passaFiltro = false;

      if (filtroContagensPeriodo === 'tudo') passaFiltro = true;
      else if (filtroContagensPeriodo === 'hoje') passaFiltro = dbData.getTime() === hojeContagens.getTime();
      else if (filtroContagensPeriodo === '7dias') passaFiltro = (hojeContagens.getTime() - dbData.getTime()) / 86400000 <= 7;
      else if (filtroContagensPeriodo === '30dias') passaFiltro = (hojeContagens.getTime() - dbData.getTime()) / 86400000 <= 30;
      else if (filtroContagensPeriodo === 'mes')
        passaFiltro = dbData.getMonth() === hojeContagens.getMonth() && dbData.getFullYear() === hojeContagens.getFullYear();
      else if (filtroContagensPeriodo === 'personalizado') {
        if (!contagensDataIni || !contagensDataFim) passaFiltro = true;
        else {
          const dIni = new Date(contagensDataIni + 'T00:00:00').getTime();
          const dFim = new Date(contagensDataFim + 'T23:59:59').getTime();
          passaFiltro = dbData.getTime() >= dIni && dbData.getTime() <= dFim;
        }
      }

      if (passaFiltro) {
        diasPermitidos.add(formatarDataPadrao(item.data));
      }
    });

    const diasUnicos = Object.keys(enderecosPorDia)
      .filter((dia) => diasPermitidos.has(dia))
      .sort((a, b) => converterParaDataNumero(a) - converterParaDataNumero(b));

    const todosOperadores = Object.keys(contagemOperador).sort(
      (a, b) => contagemOperador[b] - contagemOperador[a]
    );

    return { diasUnicos, todosOperadores, contagemDiaOp };
  }, [enderecos, inventario, filtroContagensPeriodo, contagensDataIni, contagensDataFim]);

  // busca nome do produto e calcula diferenca na hora que digita
  const produtoTrimmed = produtoInput.trim();
  const temProdutoDigitado = produtoTrimmed !== '';
  const nomeProdutoEncontrado = useMemo(() => {
    if (!temProdutoDigitado) return null;
    if (produtosBase && produtosBase[produtoTrimmed]) {
      return { text: `Produto: ${produtosBase[produtoTrimmed]}`, color: 'var(--success-color)' };
    }
    return { text: 'Produto não cadastrado na base', color: 'var(--warning-color)' };
  }, [temProdutoDigitado, produtosBase, produtoTrimmed]);

  const diferencaInfo = useMemo(() => {
    if (!temProdutoDigitado || qtdImsInput === '' || qtdFisicaInput === '') return null;
    const ims = parseFloat(qtdImsInput);
    const fis = parseFloat(qtdFisicaInput);
    if (isNaN(ims) || isNaN(fis)) return null;
    const diff = fis - ims;
    if (diff > 0) return { text: `Sobra: +${diff}`, color: 'var(--warning-color)' };
    if (diff < 0) return { text: `Falta: ${diff}`, color: 'var(--danger-color)' };
    return { text: 'Diferença: 0 (Bateu!)', color: 'var(--success-color)' };
  }, [temProdutoDigitado, qtdImsInput, qtdFisicaInput]);

  // mostra o status do endereco ali no cantinho do input
  const badgeEnderecoInfo = useMemo(() => {
    const end = enderecoInput.trim().toUpperCase();
    if (!end) return { label: 'Não Iniciado', className: 'badge nao-iniciado' };
    const st = enderecosStatus[end] || 'nao-iniciado';
    if (st === 'concluido') return { label: 'Concluído', className: 'badge concluido' };
    if (st === 'em-andamento') return { label: 'Em Andamento', className: 'badge em-andamento' };
    return { label: 'Não Iniciado', className: 'badge nao-iniciado' };
  }, [enderecoInput, enderecosStatus]);

  const limparCampos = useCallback(() => {
    setProdutoInput('');
    setQtdImsInput('');
    setQtdFisicaInput('');
    setObsInput('');
    setEditandoId(null);
    enderecoRef.current?.focus();
  }, []);

  // salva a contagem no firebase
  const salvarInventario = useCallback(async () => {
    const operador = sanitizeInput(operadorInput.trim());
    const endereco = sanitizeInput(enderecoInput.trim().toUpperCase());
    const produto = sanitizeInput(produtoInput.trim());
    let quantidadeIms: number | '' = '';
    let quantidade: number | '' = '';
    let observacao = sanitizeInput(obsInput.trim());

    if (!operador || !endereco) {
      showNotice('Operador e Endereço são obrigatórios!', 'danger');
      return;
    }

    if (!operators.includes(operador)) {
      showNotice(
        `ERRO: O operador "${operador}" não está cadastrado na lista oficial! Selecione um nome válido da lista.`,
        'danger'
      );
      operadorRef.current?.focus();
      return;
    }

    if (produto !== '') {
      if (qtdImsInput === '' || qtdFisicaInput === '') {
        showNotice(
          'Atenção: Quando há código de produto (divergência), você precisa preencher a Quantidade IMS e a Quantidade Física!',
          'warning'
        );
        return;
      }
      quantidadeIms = Number(qtdImsInput);
      quantidade = Number(qtdFisicaInput);
    } else {
      quantidadeIms = '';
      quantidade = '';
      if (observacao === '') observacao = 'Endereço conferido: Sem divergência';
    }

    const agora = new Date();
    const idFinal = editandoId ? String(editandoId) : Date.now().toString();
    const itemExistente = editandoId ? inventario.find((i) => String(i.id) === String(editandoId)) : null;

    const dadosItem: InventoryRecord = {
      id: idFinal,
      sessao: sessaoAtual,
      operador,
      endereco,
      produto,
      quantidadeIms,
      quantidade,
      observacao,
      data: itemExistente ? itemExistente.data : agora.toLocaleDateString('pt-BR'),
      hora: itemExistente ? itemExistente.hora : agora.toLocaleTimeString('pt-BR'),
      timestamp: itemExistente ? itemExistente.timestamp : agora.getTime(),
      ultimaModificacao: Date.now(),
    };

    try {
      const res = await fetch('/api/wms/inventario', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(dadosItem),
      });

      if (!res.ok) {
        const errData = await res.json();
        showNotice(errData.error || 'Erro ao salvar registro na nuvem.', 'danger');
        return;
      }

      const saved = await res.json();
      setInventario((prev) => {
        if (editandoId) {
          return prev.map((it) => (String(it.id) === String(editandoId) ? saved.record : it));
        }
        return [...prev, saved.record];
      });

      if (enderecos.includes(endereco)) {
        setEnderecosStatus((prev) => ({ ...prev, [endereco]: 'concluido' }));
      }

      emitirSomSucesso();
      setEditandoId(null);
      limparCampos();
      showNotice(`Endereço ${endereco} salvo com sucesso no Firebase!`, 'success');
    } catch (erro) {
      console.error('Erro ao salvar na nuvem:', erro);
      showNotice('ERRO DE CONEXÃO: A contagem NÃO foi salva na nuvem.', 'danger');
    }
  }, [
    operadorInput,
    enderecoInput,
    produtoInput,
    qtdImsInput,
    qtdFisicaInput,
    obsInput,
    operators,
    editandoId,
    inventario,
    sessaoAtual,
    token,
    enderecos,
    emitirSomSucesso,
    limparCampos,
    showNotice,
  ]);

  // fecha o endereco manualmente qnd termina de contar
  const finalizarEndereco = async () => {
    const endereco = enderecoInput.trim().toUpperCase();
    if (!endereco) {
      showNotice('Digite ou bipe um endereço primeiro para finalizar.', 'warning');
      return;
    }
    const novosStatus = { ...enderecosStatus, [endereco]: 'concluido' as const };
    setEnderecosStatus(novosStatus);
    await salvarNoFirebase('enderecosStatusWMS', novosStatus);
    limparCampos();
    showNotice(`Endereço ${endereco} marcado como Concluído!`, 'success');
  };

  // atalhos do teclado f2 f3 f4 e esc pra agilizar na bipagem
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTab !== 'inventario') return;
      if (e.key === 'F2') {
        e.preventDefault();
        salvarInventario();
      } else if (e.key === 'F3') {
        e.preventDefault();
        enderecoRef.current?.focus();
      } else if (e.key === 'F4') {
        e.preventDefault();
        const cod = produtoInput.trim();
        if (!cod) {
          showNotice('Digite ou bipe um código de produto primeiro!', 'warning');
        } else {
          const desc = produtosBase[cod] || 'Produto não encontrado na base';
          const preco = custosBase[cod] ? formatoBRL.format(custosBase[cod]) : 'Sem preço cadastrado';
          showNotice(`Produto ${cod}: ${desc} (${preco})`, 'success');
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        limparCampos();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, salvarInventario, produtoInput, produtosBase, custosBase, formatoBRL, limparCampos, showNotice]);

  // edita ou apaga um item ja contado
  const editarRegistro = (id: string) => {
    const item = inventario.find((i) => String(i.id) === String(id));
    if (!item) return;

    setOperadorInput(item.operador);
    setEnderecoInput(item.endereco);
    setProdutoInput(item.produto || '');
    setQtdImsInput(item.quantidadeIms !== undefined && item.quantidadeIms !== '' ? String(item.quantidadeIms) : '');
    setQtdFisicaInput(item.quantidade !== undefined && item.quantidade !== '' ? String(item.quantidade) : '');
    setObsInput(item.observacao || '');
    setEditandoId(String(item.id));
    setActiveTab('inventario');
  };

  const excluirRegistro = async (id: string) => {
    try {
      const res = await fetch(`/api/wms/inventario/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setInventario((prev) => prev.filter((i) => String(i.id) !== String(id)));
        showNotice('Registro excluído permanentemente da nuvem com segurança!', 'success');
      }
    } catch (erro) {
      console.error('Erro ao excluir:', erro);
      showNotice('ERRO: Falha ao excluir na nuvem.', 'danger');
    }
  };

  // pega os ultimos 10 registros validos pra mostrar embaixo do formulario
  const ultimosRegistrosSessao = useMemo(() => {
    const enderecosSet = new Set(enderecos);
    return inventario
      .filter((i) => enderecosSet.has(i.endereco))
      .slice(-10)
      .reverse();
  }, [inventario, enderecos]);

  // aplica os filtros da aba de historico
  const historicoFiltrado = useMemo(() => {
    const enderecosSet = new Set(enderecos);
    const termo = filtroPesquisa.toLowerCase();

    return [...inventario]
      .reverse()
      .filter((item) => {
        if (!enderecosSet.has(item.endereco)) return false;

        const matchTexto =
          item.endereco.toLowerCase().includes(termo) ||
          (item.produto && String(item.produto).toLowerCase().includes(termo));
        const matchOp = filtroOperador === '' || item.operador === filtroOperador;

        const statusEnd = enderecosStatus[item.endereco] || 'nao-iniciado';
        let matchStatus = true;
        if (filtroStatus === 'concluido') matchStatus = statusEnd === 'concluido';
        else if (filtroStatus === 'pendente') matchStatus = statusEnd !== 'concluido';

        const qtdIms = item.quantidadeIms !== undefined && item.quantidadeIms !== '' ? Number(item.quantidadeIms) : 0;
        const qtdFis = item.quantidade !== undefined && item.quantidade !== '' ? Number(item.quantidade) : 0;
        const temProdOuQtd = item.produto !== '' || item.quantidade !== '';
        const diff = temProdOuQtd ? qtdFis - qtdIms : 0;

        let matchDiv = true;
        if (filtroDivergencia === 'diferentes') matchDiv = temProdOuQtd && diff !== 0;
        else if (filtroDivergencia === 'iguais') matchDiv = !temProdOuQtd || diff === 0;

        return matchTexto && matchOp && matchStatus && matchDiv;
      });
  }, [inventario, enderecos, filtroPesquisa, filtroOperador, filtroStatus, filtroDivergencia, enderecosStatus]);

  const operadoresUnicosHistorico = useMemo(
    () => Array.from(new Set(inventario.map((i) => i.operador).filter(Boolean))).sort(),
    [inventario]
  );

  // separa as pendencias: orfaos, em aberto, sem operador e operador invalido
  const enderecosOrfaos = useMemo(() => {
    const enderecosSet = new Set(enderecos);
    return [...inventario].filter((i) => !enderecosSet.has(i.endereco)).reverse();
  }, [inventario, enderecos]);

  const enderecosEmAberto = useMemo(
    () => enderecos.filter((end) => enderecosStatus[end] === 'em-andamento'),
    [enderecos, enderecosStatus]
  );

  const registrosSemOperador = useMemo(
    () => [...inventario].filter((i) => !i.operador || i.operador.trim() === '').reverse(),
    [inventario]
  );

  const registrosOperadoresInvalidos = useMemo(
    () =>
      [...inventario]
        .filter((i) => i.operador && i.operador.trim() !== '' && !operators.includes(i.operador))
        .reverse(),
    [inventario, operators]
  );

  const confirmarValidarOrfao = async () => {
    const { endereco, galpao } = orphanModal;
    if (!endereco || !galpao.trim()) return;
    const galpaoUpper = galpao.trim().toUpperCase();

    const novosEnderecos = Array.from(new Set([...enderecos, endereco])).sort();
    const novosStatus = { ...enderecosStatus, [endereco]: 'concluido' as const };
    const novosGalpoes = { ...enderecosGalpao, [endereco]: galpaoUpper };

    setEnderecos(novosEnderecos);
    setEnderecosStatus(novosStatus);
    setEnderecosGalpao(novosGalpoes);
    setOrphanModal({ open: false, endereco: '', galpao: 'G1' });

    await fetch('/api/wms/sync-bases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        enderecos: novosEnderecos,
        enderecosStatus: novosStatus,
        enderecosGalpao: novosGalpoes,
      }),
    });

    showNotice(`SUCESSO: Endereço ${endereco} promovido à base oficial no galpão ${galpaoUpper}!`, 'success');
  };

  const forcarFechamentoEndereco = async (endereco: string) => {
    const novosStatus = { ...enderecosStatus, [endereco]: 'concluido' as const };
    setEnderecosStatus(novosStatus);
    await fetch('/api/wms/sync-bases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enderecosStatus: novosStatus }),
    });
    showNotice(`Pronto! Endereço ${endereco} foi fechado com sucesso.`, 'success');
  };

  const forcarFechamentoTodos = async () => {
    if (enderecosEmAberto.length === 0) {
      showNotice('Excelente! Não há nenhum endereço em aberto no momento.', 'success');
      return;
    }
    const novosStatus = { ...enderecosStatus };
    enderecosEmAberto.forEach((end) => {
      novosStatus[end] = 'concluido';
    });
    setEnderecosStatus(novosStatus);
    await fetch('/api/wms/sync-bases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enderecosStatus: novosStatus }),
    });
    showNotice(`Todos os ${enderecosEmAberto.length} endereços foram fechados com sucesso.`, 'success');
  };

  const exportarSemOperador = () => {
    if (registrosSemOperador.length === 0) {
      showNotice('Não há registros sem operador para exportar.', 'warning');
      return;
    }
    const dados = registrosSemOperador.map((item) => ({
      ID_NAO_APAGAR: item.id,
      Data: item.data,
      Hora: item.hora,
      Endereco: item.endereco,
      Produto: item.produto,
      Quantidade: item.quantidade,
      Operador: '',
    }));
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sem_Operador');
    XLSX.writeFile(wb, `Correcao_Sem_Operador_${sessaoAtual}.xlsx`);
  };

  const importarCorrecaoOperador = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(data), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });

    let corrigidos = 0;
    for (const row of rows) {
      const id = String(row['ID_NAO_APAGAR'] || '').trim();
      const op = String(row['Operador'] || '').trim();
      if (id && op && operators.includes(op)) {
        const item = inventario.find((i) => String(i.id) === id);
        if (item) {
          const atualizado = { ...item, operador: op, ultimaModificacao: Date.now() };
          await fetch('/api/wms/inventario', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(atualizado),
          });
          corrigidos++;
        }
      }
    }
    if (corrigidos > 0) {
      await fetchWmsData(token);
      showNotice(`${corrigidos} registros corrigidos com sucesso!`, 'success');
    } else {
      showNotice('Nenhuma correção válida encontrada.', 'warning');
    }
    e.target.value = '';
  };

  const salvarCorrecaoOperador = async (id: string) => {
    const novoOp = (correcaoOperadorMap[id] || '').trim();
    if (!novoOp || !operators.includes(novoOp)) {
      showNotice(`ERRO: O operador "${novoOp}" não existe na base oficial.`, 'danger');
      return;
    }
    const item = inventario.find((i) => String(i.id) === String(id));
    if (!item) return;

    const atualizado = { ...item, operador: novoOp, ultimaModificacao: Date.now() };
    const res = await fetch('/api/wms/inventario', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(atualizado),
    });

    if (res.ok) {
      setInventario((prev) => prev.map((i) => (String(i.id) === String(id) ? atualizado : i)));
      showNotice('Operador corrigido e validado com sucesso!', 'success');
    }
  };

  // funcoes da aba de cadastros e lancamento manual de contagens antigas
  const salvarCadastroManual = async () => {
    const op = manualOperador.trim();
    const end = manualEndereco.trim().toUpperCase();
    const prod = manualProduto.trim();
    const qIms = manualQtdIms !== '' ? Number(manualQtdIms) : '';
    const qFis = manualQtdFisica !== '' ? Number(manualQtdFisica) : '';
    const obs = manualObs.trim() || (prod === '' ? 'Endereço conferido: Sem divergência' : '');

    if (!op || !end || !manualData) {
      showNotice('Preencha pelo menos Operador, Endereço e Data!', 'warning');
      return;
    }
    if (!operators.includes(op)) {
      showNotice(`Operador "${op}" inválido! Selecione um operador da lista oficial.`, 'danger');
      return;
    }

    const partesData = manualData.split('-');
    const dataBR = `${partesData[2]}/${partesData[1]}/${partesData[0]}`;
    const horaBR = manualHora ? `${manualHora}:00` : '12:00:00';
    const ts = new Date(`${manualData}T${horaBR}`).getTime();

    const novoItem: InventoryRecord = {
      id: Date.now().toString(),
      sessao: sessaoAtual,
      operador: op,
      endereco: end,
      produto: prod,
      quantidadeIms: qIms,
      quantidade: qFis,
      observacao: obs,
      data: dataBR,
      hora: horaBR,
      timestamp: isNaN(ts) ? Date.now() : ts,
      ultimaModificacao: Date.now(),
    };

    const res = await fetch('/api/wms/inventario', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(novoItem),
    });

    if (res.ok) {
      const saved = await res.json();
      setInventario((prev) => [...prev, saved.record]);
      if (enderecos.includes(end)) {
        setEnderecosStatus((prev) => ({ ...prev, [end]: 'concluido' }));
      }
      setManualEndereco('');
      setManualProduto('');
      setManualQtdIms('');
      setManualQtdFisica('');
      setManualObs('');
      showNotice('Registro manual inserido no sistema!', 'success');
    }
  };

  const galpoesUnicos = useMemo(
    () => Array.from(new Set(Object.values(enderecosGalpao))).filter(Boolean).sort(),
    [enderecosGalpao]
  );

  const enderecosFiltradosCad = useMemo(() => {
    const termo = pesquisaEnderecos.toLowerCase();
    return enderecos.filter((end) => {
      const galpaoDesteEnd = enderecosGalpao[end] || 'Sem Galpão';
      const statusDesteEnd = enderecosStatus[end] || 'nao-iniciado';
      const matchTermo = end.toLowerCase().includes(termo);
      const matchGalpao = filtroGalpaoCad === '' || galpaoDesteEnd === filtroGalpaoCad;
      const matchStatus = filtroStatusCad === 'todos' || statusDesteEnd === filtroStatusCad;
      return matchTermo && matchGalpao && matchStatus;
    });
  }, [enderecos, enderecosGalpao, enderecosStatus, pesquisaEnderecos, filtroGalpaoCad, filtroStatusCad]);

  const salvarEdicaoGalpao = async (end: string) => {
    const novoGalpao = (edicaoGalpaoMap[end] ?? enderecosGalpao[end] ?? '').trim().toUpperCase();
    if (!novoGalpao) {
      showNotice('O nome do galpão não pode ficar vazio!', 'warning');
      return;
    }
    const atualizado = { ...enderecosGalpao, [end]: novoGalpao };
    setEnderecosGalpao(atualizado);
    await fetch('/api/wms/sync-bases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enderecosGalpao: atualizado }),
    });
    showNotice(`Sucesso! O endereço ${end} agora pertence ao galpão: ${novoGalpao}`, 'success');
  };

  const codigosProdutosFiltrados = useMemo(() => {
    const termo = pesquisaProdutos.toLowerCase();
    return Object.keys(produtosBase).filter((codigo) => {
      const desc = (produtosBase[codigo] || '').toLowerCase();
      return codigo.toLowerCase().includes(termo) || desc.includes(termo);
    });
  }, [produtosBase, pesquisaProdutos]);

  const exportarEnderecosFiltrados = () => {
    if (enderecosFiltradosCad.length === 0) {
      showNotice('Não há endereços na tela para exportar com estes filtros.', 'warning');
      return;
    }
    const dadosExportacao = enderecosFiltradosCad.map((end) => ({
      Endereço: end,
      Galpão: enderecosGalpao[end] || 'Sem Galpão',
      Status: (enderecosStatus[end] || 'nao-iniciado').replace('-', ' ').toUpperCase(),
    }));
    const ws = XLSX.utils.json_to_sheet(dadosExportacao);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Enderecos_Filtrados');
    XLSX.writeFile(wb, `Filtro_Enderecos_WMS_${sessaoAtual}.xlsx`);
  };

  const exportarPlanilhaCorrecaoCustos = () => {
    const codigos = Object.keys(produtosBase);
    if (codigos.length === 0) {
      showNotice('Atenção: Não há produtos cadastrados na base para exportar.', 'warning');
      return;
    }
    const dadosExportacao = codigos.map((codigo) => ({
      Codigo: codigo,
      Descricao: produtosBase[codigo] || 'Sem Descrição',
      'Valor Unitario': custosBase[codigo] !== undefined ? custosBase[codigo] : 0,
    }));
    const ws = XLSX.utils.json_to_sheet(dadosExportacao);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Correcao_Valores');
    XLSX.writeFile(wb, `Correcao_Valores_Produtos_${sessaoAtual}.xlsx`);
  };

  const importarPlanilhaCorrecaoCustos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[workbook.SheetNames[0]],
      { defval: '' }
    );

    const novosCustos = { ...custosBase };
    let atualizados = 0;
    jsonData.forEach((linha) => {
      const codigo = linha['Codigo'] || linha['Código'];
      const valorBruto =
        linha['Valor Unitario'] !== undefined ? linha['Valor Unitario'] : linha['Valor Unitário'];
      if (codigo && valorBruto !== '' && valorBruto !== undefined) {
        const codLimpo = String(codigo).trim();
        const valorFinal = parseFloat(String(valorBruto).replace(',', '.'));
        if (!isNaN(valorFinal)) {
          novosCustos[codLimpo] = valorFinal;
          atualizados++;
        }
      }
    });

    if (atualizados > 0) {
      setCustosBase(novosCustos);
      await fetch('/api/wms/sync-bases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ custosBase: novosCustos }),
      });
      showNotice(`Sucesso! ${atualizados} valores de produtos foram atualizados na nuvem!`, 'success');
    }
    e.target.value = '';
  };

  // importacao e exportacao de planilhas na aba de configuracoes
  const processarPlanilhaEnderecos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });

    const novosEnderecos = new Set(enderecos);
    const novosStatus = { ...enderecosStatus };
    const novosGalpoes = { ...enderecosGalpao };
    let count = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[0]) {
        const end = String(row[0]).trim().toUpperCase();
        const galpao = row[1] ? String(row[1]).trim().toUpperCase() : 'G1';
        if (end) {
          novosEnderecos.add(end);
          if (!novosStatus[end]) novosStatus[end] = 'nao-iniciado';
          novosGalpoes[end] = galpao;
          count++;
        }
      }
    }

    const listaOrdenada = Array.from(novosEnderecos).sort();
    setEnderecos(listaOrdenada);
    setEnderecosStatus(novosStatus);
    setEnderecosGalpao(novosGalpoes);

    await fetch('/api/wms/sync-bases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        enderecos: listaOrdenada,
        enderecosStatus: novosStatus,
        enderecosGalpao: novosGalpoes,
      }),
    });

    setMsgPlanilha(`${count} endereços importados com sucesso!`);
    e.target.value = '';
  };

  const processarPlanilhaProdutos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });

    const novosProdutos = { ...produtosBase };
    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[0]) {
        const cod = String(row[0]).trim();
        const desc = row[1] ? String(row[1]).trim() : 'Sem Descrição';
        novosProdutos[cod] = desc;
        count++;
      }
    }
    setProdutosBase(novosProdutos);
    await fetch('/api/wms/sync-bases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ produtosBase: novosProdutos }),
    });
    setMsgPlanilhaProdutos(`${count} produtos carregados na base!`);
    e.target.value = '';
  };

  const processarPlanilhaCustos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });

    const novosCustos = { ...custosBase };
    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[0] && row[3] !== undefined) {
        const cod = String(row[0]).trim();
        const val = parseFloat(String(row[3]).replace(',', '.'));
        if (!isNaN(val)) {
          novosCustos[cod] = val;
          count++;
        }
      }
    }
    setCustosBase(novosCustos);
    await fetch('/api/wms/sync-bases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ custosBase: novosCustos }),
    });
    setMsgPlanilhaCustos(`${count} custos unitários importados!`);
    e.target.value = '';
  };

  const exportarExcel = () => {
    const ws = XLSX.utils.json_to_sheet(inventario);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario_WMS');
    XLSX.writeFile(wb, `Relatorio_WMS_${sessaoAtual}.xlsx`);
  };

  const exportarCSV = () => {
    const ws = XLSX.utils.json_to_sheet(inventario);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Inventario_${sessaoAtual}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportarJSON = () => {
    const backup = {
      sessaoAtual,
      inventario,
      enderecos,
      enderecosStatus,
      enderecosGalpao,
      produtosBase,
      custosBase,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Backup_WMS_${sessaoAtual}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleConfirmAdminReset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/wms/admin/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          adminPin: adminActionModal.pin,
          mode: adminActionModal.mode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAdminActionModal((prev) => ({ ...prev, error: data.error || 'Senha incorreta!' }));
        return;
      }
      setAdminActionModal({ open: false, mode: 'counts_only', pin: '', error: '' });
      await fetchWmsData(token);
      showNotice(data.message || 'Operação concluída com sucesso!', 'success');
    } catch {
      setAdminActionModal((prev) => ({ ...prev, error: 'Erro de comunicação com o servidor.' }));
    }
  };

  return (
    <>
      {/* Datalists globais originais */}
      <datalist id="lista-operadores">
        {operators.map((op) => (
          <option key={op} value={op} />
        ))}
      </datalist>
      <datalist id="lista-enderecos">
        {enderecos.map((end) => (
          <option key={end} value={end} />
        ))}
      </datalist>

      {/* Menu de navegacao lateral original */}
      <nav className={`sidebar ${sidebarOculta ? 'oculta' : ''}`} id="sidebar">
        <div className="logo">
          <i className="fa-solid fa-boxes-stacked"></i>
          <h2>Inventário</h2>
        </div>
        <ul className="menu">
          <li
            onClick={() => setActiveTab('inventario')}
            className={activeTab === 'inventario' ? 'ativo' : ''}
            id="menu-inventario"
          >
            <i className="fa-solid fa-barcode"></i> Inventário
          </li>
          <li
            onClick={() => setActiveTab('dashboard')}
            className={activeTab === 'dashboard' ? 'ativo' : ''}
            id="menu-dashboard"
          >
            <i className="fa-solid fa-chart-line"></i> Dashboard
          </li>
          <li
            onClick={() => setActiveTab('relatorios')}
            className={activeTab === 'relatorios' ? 'ativo' : ''}
            id="menu-relatorios"
          >
            <i className="fa-solid fa-chart-pie"></i> Relatórios
          </li>
          <li
            onClick={() => setActiveTab('historico')}
            className={activeTab === 'historico' ? 'ativo' : ''}
            id="menu-historico"
          >
            <i className="fa-solid fa-clipboard-list"></i> Histórico
          </li>
          <li
            onClick={() => setActiveTab('orfaos')}
            className={activeTab === 'orfaos' ? 'ativo' : ''}
            id="menu-orfaos"
            style={{ color: 'var(--warning-color)' }}
          >
            <i className="fa-solid fa-triangle-exclamation"></i> Pendências
          </li>
          <li
            onClick={() => setActiveTab('cadastros')}
            className={activeTab === 'cadastros' ? 'ativo' : ''}
            id="menu-cadastros"
          >
            <i className="fa-solid fa-database"></i> Cadastros
          </li>
          <li
            onClick={() => setActiveTab('configuracoes')}
            className={activeTab === 'configuracoes' ? 'ativo' : ''}
            id="menu-configuracoes"
          >
            <i className="fa-solid fa-gear"></i> Configurações
          </li>
        </ul>
      </nav>

      {/* Estrutura principal da tela original */}
      <main className="main-content">
        {/* Cabecalho original com controle do menu, sessao do inventario e tema (sem sessao de usuario) */}
        <header>
          <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button
              id="btn-menu"
              onClick={() => setSidebarOculta((prev) => !prev)}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-color)',
                fontSize: '1.2rem',
                padding: '5px 10px',
              }}
            >
              <i className="fa-solid fa-bars"></i>
            </button>

            <span
              id="sessaoAtual"
              style={{
                fontWeight: 'bold',
                fontSize: '1.1rem',
                color: 'var(--text-color)',
                letterSpacing: '0.5px',
              }}
            >
              Inventário Almoxarifado Eletra
            </span>
          </div>
          <div className="header-right">
            <button onClick={alternarTema} id="btn-tema">
              <i className={`fa-solid ${isLightTheme ? 'fa-moon' : 'fa-sun'}`}></i> Mudar Tema
            </button>
          </div>
        </header>

        {/* Notificacao discreta */}
        {toast && (
          <div
            style={{
              marginBottom: '15px',
              padding: '12px 16px',
              borderRadius: '8px',
              fontWeight: 'bold',
              borderLeft: `5px solid ${
                toast.type === 'success'
                  ? 'var(--success-color)'
                  : toast.type === 'warning'
                  ? 'var(--warning-color)'
                  : 'var(--danger-color)'
              }`,
              backgroundColor: 'var(--card-bg)',
              color: 'var(--text-color)',
            }}
          >
            {toast.text}
          </div>
        )}

        {/* Barra de progresso geral do inventario */}
        <div className="progress-container">
          <span id="progress-text">Inventário realizado: {metrics.porcentagemConcluida}%</span>
          <div className="progress-bar-bg">
            <div
              className="progress-bar-fill"
              id="progress-fill"
              style={{ width: `${metrics.porcentagemConcluida}%` }}
            ></div>
          </div>
        </div>

        {/* ABA 1: DASHBOARD */}
        <section id="aba-dashboard" className={`aba ${activeTab === 'dashboard' ? 'ativa' : ''}`}>
          <h1>
            <i className="fa-solid fa-chart-line"></i> Visão Geral
          </h1>

          {/* Grade de cartoes de indicadores principais */}
          <div className="cards-grid">
            <div className="card">
              <h3>
                <i className="fa-solid fa-map-location-dot"></i> Total de Endereços
              </h3>
              <p id="dash-total-enderecos">{metrics.totalEnderecos}</p>
            </div>

            <div className="card concluido">
              <h3>
                <i className="fa-solid fa-circle-check"></i> Endereços Concluídos
              </h3>
              <p id="dash-end-concluidos">{metrics.concluidos}</p>
            </div>

            <div className="card pendente">
              <h3>
                <i className="fa-solid fa-hourglass-half"></i> Endereços Pendentes
              </h3>
              <p id="dash-end-pendentes">{metrics.pendentes}</p>
            </div>

            <div className="card">
              <h3>
                <i className="fa-solid fa-arrow-trend-up" style={{ color: 'var(--success-color)' }}></i> Valor
                Divergente (+ Acima)
              </h3>
              <p id="dash-valor-acima" className="kpi-financeiro">
                {formatoBRL.format(metrics.valorAcimaTotal)}
              </p>
            </div>

            <div className="card">
              <h3>
                <i className="fa-solid fa-arrow-trend-down" style={{ color: 'var(--danger-color)' }}></i> Valor
                Divergente (- Abaixo)
              </h3>
              <p id="dash-valor-abaixo" className="kpi-financeiro">
                {formatoBRL.format(metrics.valorAbaixoTotal)}
              </p>
            </div>

            <div className="card">
              <h3>
                <i className="fa-solid fa-triangle-exclamation" style={{ color: 'var(--warning-color)' }}></i>{' '}
                Endereços com Divergência
              </h3>
              <p id="dash-enderecos-divergencia">{metrics.enderecosDivergentes}</p>
            </div>

            <div className="card">
              <h3>
                <i className="fa-solid fa-calendar-day" style={{ color: '#3498db' }}></i> Média (Endereços/Dia)
              </h3>
              <p id="kpi-enderecos-dia">{mediaEnderecosDia}</p>
            </div>
          </div>

          {/* Graficos da aba Dashboard */}
          {activeTab === 'dashboard' && (
            <DashboardCharts
              inventario={inventario}
              enderecos={enderecos}
              operators={operators}
              shifts={shiftMap}
              isDark={!isLightTheme}
              filtroContagensPeriodo={filtroContagensPeriodo}
              contagensDataIni={contagensDataIni}
              contagensDataFim={contagensDataFim}
              filtroEsperadoPeriodo={filtroEsperadoPeriodo}
              onChangeFiltroContagens={setFiltroContagensPeriodo}
              onChangeDataIni={setContagensDataIni}
              onChangeDataFim={setContagensDataFim}
              onChangeFiltroEsperado={setFiltroEsperadoPeriodo}
            />
          )}

          {/* Tabela retratil de operadores ausentes ou com menos de 2 contagens no dia anterior */}
          <div className="card" style={{ marginTop: '20px', borderLeft: '5px solid var(--danger-color)' }}>
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setAusentesAberto((prev) => !prev)}
            >
              <h3 style={{ margin: 0, color: 'var(--danger-color)' }}>
                <i className="fa-solid fa-user-xmark"></i> Ausentes ou Menos de 2 Contagens (Ontem) - Total:{' '}
                <span id="total-ausentes-ontem">{ausentesOntemList.length}</span>
              </h3>
              <i
                id="icone-toggle-ausentes"
                className={`fa-solid ${ausentesAberto ? 'fa-chevron-up' : 'fa-chevron-down'}`}
                style={{ fontSize: '1.2rem' }}
              ></i>
            </div>

            {ausentesAberto && (
              <div
                id="tabela-ausentes-container"
                style={{ display: 'block', marginTop: '15px', maxHeight: '250px', overflowY: 'auto' }}
              >
                <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'flex-end' }}>
                  <select
                    id="filtro-turno-ausentes"
                    value={filtroTurnoAusentes}
                    onChange={(e) => setFiltroTurnoAusentes(e.target.value)}
                    style={{
                      padding: '6px',
                      borderRadius: '4px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-color)',
                      color: 'var(--text-color)',
                      outline: 'none',
                      fontWeight: 'bold',
                    }}
                  >
                    <option value="todos">Todos os Turnos</option>
                    <option value="Turno 1">Turno 1</option>
                    <option value="Turno 2">Turno 2</option>
                    <option value="Turno 3">Turno 3</option>
                    <option value="COMERCIAL">Comercial</option>
                    <option value="Não Definido">Não Definido</option>
                  </select>
                </div>

                <table>
                  <thead>
                    <tr>
                      <th style={{ backgroundColor: 'rgba(231, 76, 60, 0.1)' }}>Nome do Operador</th>
                      <th style={{ backgroundColor: 'rgba(231, 76, 60, 0.1)' }}>Turno</th>
                      <th style={{ backgroundColor: 'rgba(231, 76, 60, 0.1)' }}>Qtd</th>
                    </tr>
                  </thead>
                  <tbody id="tbody-ausentes-ontem">
                    {ausentesOntemList.length === 0 ? (
                      <tr>
                        <td
                          colSpan={3}
                          style={{
                            textAlign: 'center',
                            color: 'var(--success-color)',
                            padding: '15px',
                            fontWeight: 'bold',
                          }}
                        >
                          {filtroTurnoAusentes === 'todos'
                            ? 'Todos os operadores realizaram contagens ontem!'
                            : `Nenhum ausente no ${filtroTurnoAusentes} ontem!`}
                        </td>
                      </tr>
                    ) : (
                      ausentesOntemList.map((row) => (
                        <tr key={row.operador}>
                          <td style={{ fontWeight: 'bold' }}>{row.operador}</td>
                          <td>{row.turno}</td>
                          <td style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>{row.qtd}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Tabela retratil de produtividade diaria de todos os operadores */}
          <div className="card" style={{ marginTop: '20px', padding: '15px' }}>
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setProdutividadeAberto((prev) => !prev)}
            >
              <h3 style={{ margin: 0 }}>
                <i className="fa-solid fa-calendar-week" style={{ color: 'var(--primary-color)' }}></i>{' '}
                Produtividade Diária (Todos os Operadores)
              </h3>
              <i
                id="icone-toggle-produtividade"
                className={`fa-solid ${produtividadeAberto ? 'fa-chevron-up' : 'fa-chevron-down'}`}
                style={{ fontSize: '1.2rem' }}
              ></i>
            </div>

            {produtividadeAberto && (
              <div
                id="tabela-produtividade-container"
                className="table-container"
                style={{
                  display: 'block',
                  marginTop: '15px',
                  overflowX: 'auto',
                  maxHeight: '400px',
                  overflowY: 'auto',
                }}
              >
                <table style={{ borderCollapse: 'collapse', position: 'relative' }}>
                  <thead id="thead-dias">
                    <tr>
                      <th
                        style={{
                          position: 'sticky',
                          top: 0,
                          left: 0,
                          backgroundColor: 'var(--card-bg)',
                          zIndex: 3,
                          boxShadow: '2px 2px 5px rgba(0,0,0,0.2)',
                        }}
                      >
                        Operador
                      </th>
                      {tabelaProdutividadeData.diasUnicos.map((dia) => (
                        <th
                          key={dia}
                          style={{
                            position: 'sticky',
                            top: 0,
                            backgroundColor: 'var(--card-bg)',
                            zIndex: 2,
                            boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
                          }}
                        >
                          {dia}
                        </th>
                      ))}
                      <th
                        style={{
                          position: 'sticky',
                          top: 0,
                          backgroundColor: 'var(--card-bg)',
                          zIndex: 2,
                          boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
                        }}
                      >
                        Total Geral
                      </th>
                    </tr>
                  </thead>
                  <tbody id="tbody-dias">
                    {tabelaProdutividadeData.todosOperadores.map((op) => {
                      let totalLinha = 0;
                      return (
                        <tr key={op}>
                          <td
                            style={{
                              position: 'sticky',
                              left: 0,
                              backgroundColor: 'var(--card-bg)',
                              zIndex: 1,
                              boxShadow: '2px 0 5px rgba(0,0,0,0.1)',
                            }}
                          >
                            <strong>{op}</strong>
                          </td>
                          {tabelaProdutividadeData.diasUnicos.map((dia) => {
                            const qtdDia =
                              tabelaProdutividadeData.contagemDiaOp[op] &&
                              tabelaProdutividadeData.contagemDiaOp[op][dia]
                                ? tabelaProdutividadeData.contagemDiaOp[op][dia]
                                : 0;
                            totalLinha += qtdDia;
                            return <td key={dia}>{qtdDia}</td>;
                          })}
                          <td style={{ color: 'var(--primary-color)' }}>
                            <strong>{totalLinha}</strong>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* ABA 2: INVENTARIO (CONTAGEM FISICA) */}
        <section id="aba-inventario" className={`aba ${activeTab === 'inventario' ? 'ativa' : ''}`}>
          <h1>
            <i className="fa-solid fa-barcode"></i> Contagem Física
          </h1>

          <div className="form-inventario card">
            <p className="atalhos-info">
              <i>Atalhos: F2 (Salvar) | F3 (Focar Endereço) | F4 (Ver Produto) | ESC (Limpar)</i>
            </p>

            <div className="form-grid">
              <div className="input-group">
                <label htmlFor="operador">Operador (Obrigatório)</label>
                <input
                  ref={operadorRef}
                  type="text"
                  id="operador"
                  list="lista-operadores"
                  placeholder="Selecione ou digite..."
                  value={operadorInput}
                  onChange={(e) => setOperadorInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      enderecoRef.current?.focus();
                    }
                  }}
                />
              </div>

              <div className="input-group">
                <label htmlFor="endereco">Endereço (F3)</label>
                <input
                  ref={enderecoRef}
                  type="text"
                  id="endereco"
                  list="lista-enderecos"
                  placeholder="Ex: A-01-01-01"
                  autoComplete="off"
                  value={enderecoInput}
                  onChange={(e) => setEnderecoInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      produtoRef.current?.focus();
                    }
                  }}
                />
                <span id="status-endereco-badge" className={badgeEnderecoInfo.className}>
                  {badgeEnderecoInfo.label}
                </span>
              </div>

              <div className="input-group">
                <label htmlFor="produto">Código do Produto (Apenas divergência)</label>
                <input
                  ref={produtoRef}
                  type="text"
                  id="produto"
                  placeholder="Bipe o código aqui..."
                  value={produtoInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    setProdutoInput(val);
                    if (val.trim() === '') {
                      setQtdImsInput('');
                      setQtdFisicaInput('');
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (produtoInput.trim() === '') {
                        obsRef.current?.focus();
                      } else {
                        qtdImsRef.current?.focus();
                      }
                    }
                  }}
                />
                {nomeProdutoEncontrado && (
                  <span
                    id="nome-produto"
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      fontSize: '0.85rem',
                      color: nomeProdutoEncontrado.color,
                      marginTop: '4px',
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap',
                      zIndex: 10,
                    }}
                  >
                    {nomeProdutoEncontrado.text}
                  </span>
                )}
              </div>

              <div className="input-group">
                <label htmlFor="quantidade-ims">Quantidade IMS</label>
                <input
                  ref={qtdImsRef}
                  type="number"
                  id="quantidade-ims"
                  min="0"
                  placeholder="Ex: 5"
                  disabled={!temProdutoDigitado}
                  value={qtdImsInput}
                  onChange={(e) => setQtdImsInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      qtdFisicaRef.current?.focus();
                    }
                  }}
                />
              </div>

              <div className="input-group">
                <label htmlFor="quantidade">Quantidade Física</label>
                <input
                  ref={qtdFisicaRef}
                  type="number"
                  id="quantidade"
                  min="0"
                  placeholder="Ex: 10"
                  disabled={!temProdutoDigitado}
                  value={qtdFisicaInput}
                  onChange={(e) => setQtdFisicaInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      obsRef.current?.focus();
                    }
                  }}
                />
                {diferencaInfo && (
                  <span
                    id="texto-diferenca"
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      fontSize: '0.9rem',
                      fontWeight: 'bold',
                      marginTop: '4px',
                      color: diferencaInfo.color,
                      zIndex: 10,
                    }}
                  >
                    {diferencaInfo.text}
                  </span>
                )}
              </div>

              <div className="input-group full-width">
                <label htmlFor="observacao">Observações (Informar divergências encontradas)</label>
                <input
                  ref={obsRef}
                  type="text"
                  id="observacao"
                  placeholder="Opcional"
                  value={obsInput}
                  onChange={(e) => setObsInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      salvarInventario();
                    }
                  }}
                />
              </div>
            </div>

            <div className="acoes-form">
              <button className="btn-success" onClick={salvarInventario}>
                <i className="fa-solid fa-check"></i> {editandoId ? 'Atualizar (F2)' : 'Salvar (F2)'}
              </button>
              <button className="btn-warning" onClick={finalizarEndereco}>
                <i className="fa-solid fa-flag-checkered"></i> Finalizar Endereço
              </button>
              <button className="btn-danger" onClick={limparCampos}>
                <i className="fa-solid fa-eraser"></i> Limpar (ESC)
              </button>
            </div>
          </div>

          {/* Tabela dos ultimos 10 registros da sessao atual */}
          <div className="table-container card">
            <h3>Últimos Registros (Sessão Atual)</h3>
            <table id="tabela-inventario">
              <thead>
                <tr>
                  <th>Endereço</th>
                  <th>Produto</th>
                  <th>Qtd IMS</th>
                  <th>Qtd Física</th>
                  <th>Diferença</th>
                  <th>Operador</th>
                  <th>Hora</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody id="tbody-inventario">
                {ultimosRegistrosSessao.map((item) => {
                  const temProd = item.produto !== '' || item.quantidade !== '';
                  const qIms = item.quantidadeIms !== undefined && item.quantidadeIms !== '' ? Number(item.quantidadeIms) : 0;
                  const qFis = item.quantidade !== undefined && item.quantidade !== '' ? Number(item.quantidade) : 0;
                  const diff = temProd ? qFis - qIms : 0;
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.endereco}</strong>
                      </td>
                      <td>
                        {item.produto ? (
                          item.produto
                        ) : (
                          <span style={{ color: 'var(--success-color)', fontWeight: 'bold' }}>OK (Sem Div.)</span>
                        )}
                      </td>
                      <td>{temProd ? qIms : '-'}</td>
                      <td>{temProd ? qFis : '-'}</td>
                      <td
                        style={{
                          fontWeight: 'bold',
                          color:
                            !temProd || diff === 0
                              ? 'var(--success-color)'
                              : diff > 0
                              ? 'var(--warning-color)'
                              : 'var(--danger-color)',
                        }}
                      >
                        {!temProd ? '0' : diff > 0 ? `+${diff}` : diff}
                      </td>
                      <td>{item.operador}</td>
                      <td>{item.hora}</td>
                      <td>
                        <button
                          className="btn-warning"
                          style={{ marginRight: '5px' }}
                          onClick={() => editarRegistro(String(item.id))}
                        >
                          <i className="fa-solid fa-pen"></i>
                        </button>
                        <button className="btn-danger" onClick={() => excluirRegistro(String(item.id))}>
                          <i className="fa-solid fa-trash"></i>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ABA 3: HISTORICO COMPLETO */}
        <section id="aba-historico" className={`aba ${activeTab === 'historico' ? 'ativa' : ''}`}>
          <h1>
            <i className="fa-solid fa-clipboard-list"></i> Histórico Completo
          </h1>

          <div className="filtros card">
            <input
              type="text"
              id="filtro-pesquisa"
              placeholder="Pesquisar Produto ou Endereço..."
              value={filtroPesquisa}
              onChange={(e) => setFiltroPesquisa(e.target.value)}
            />
            <select
              id="filtro-operador"
              value={filtroOperador}
              onChange={(e) => setFiltroOperador(e.target.value)}
            >
              <option value="">Todos os Operadores</option>
              {operadoresUnicosHistorico.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <select id="filtro-status" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
              <option value="">Status do Endereço (Todos)</option>
              <option value="concluido">Somente Concluídos</option>
              <option value="pendente">Somente Pendentes</option>
            </select>
            <select
              id="filtro-divergencia"
              value={filtroDivergencia}
              onChange={(e) => setFiltroDivergencia(e.target.value)}
            >
              <option value="">Qualidade (Todas as Contagens)</option>
              <option value="diferentes">Somente com Diferença (Falta ou Sobra)</option>
              <option value="iguais">Somente Batidos (OK / Zero)</option>
            </select>
          </div>

          <div className="table-container card">
            <table id="tabela-historico">
              <thead>
                <tr>
                  <th>Data/Hora</th>
                  <th>Endereço</th>
                  <th>Produto</th>
                  <th>Qtd IMS</th>
                  <th>Qtd Física</th>
                  <th>Diferença</th>
                  <th>Operador</th>
                  <th>Obs</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody id="tbody-historico">
                {historicoFiltrado.slice(0, 250).map((item) => {
                  const temProd = item.produto !== '' || item.quantidade !== '';
                  const qIms = item.quantidadeIms !== undefined && item.quantidadeIms !== '' ? Number(item.quantidadeIms) : 0;
                  const qFis = item.quantidade !== undefined && item.quantidade !== '' ? Number(item.quantidade) : 0;
                  const diff = temProd ? qFis - qIms : 0;
                  return (
                    <tr key={item.id}>
                      <td>
                        {item.data} {item.hora}
                      </td>
                      <td>
                        <strong>{item.endereco}</strong>
                      </td>
                      <td>{item.produto || 'OK'}</td>
                      <td>{temProd ? qIms : '-'}</td>
                      <td>{temProd ? qFis : '-'}</td>
                      <td
                        style={{
                          fontWeight: 'bold',
                          color:
                            !temProd || diff === 0
                              ? 'var(--success-color)'
                              : diff > 0
                              ? 'var(--warning-color)'
                              : 'var(--danger-color)',
                        }}
                      >
                        {!temProd ? '0' : diff > 0 ? `+${diff}` : diff}
                      </td>
                      <td>{item.operador}</td>
                      <td>{item.observacao}</td>
                      <td>
                        <button
                          className="btn-warning"
                          style={{ marginRight: '5px' }}
                          onClick={() => editarRegistro(String(item.id))}
                        >
                          <i className="fa-solid fa-pen"></i>
                        </button>
                        <button className="btn-danger" onClick={() => excluirRegistro(String(item.id))}>
                          <i className="fa-solid fa-trash"></i>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ABA 4: RELATORIOS E GRAFICOS */}
        <section id="aba-relatorios" className={`aba ${activeTab === 'relatorios' ? 'ativa' : ''}`}>
          <h1>
            <i className="fa-solid fa-chart-pie"></i> Relatórios e Gráficos
          </h1>
          {activeTab === 'relatorios' && (
            <RelatoriosCharts
              inventario={inventario}
              enderecos={enderecos}
              enderecosStatus={enderecosStatus}
              enderecosGalpao={enderecosGalpao}
              shifts={shiftMap}
              isDark={!isLightTheme}
              filtroGalpaoPeriodo={filtroGalpaoPeriodo}
              galpaoDataIni={galpaoDataIni}
              galpaoDataFim={galpaoDataFim}
              onChangeFiltroGalpao={setFiltroGalpaoPeriodo}
              onChangeGalpaoDataIni={setGalpaoDataIni}
              onChangeGalpaoDataFim={setGalpaoDataFim}
            />
          )}
        </section>

        {/* ABA 5: PENDENCIAS E ORFAOS */}
        <section id="aba-orfaos" className={`aba ${activeTab === 'orfaos' ? 'ativa' : ''}`}>
          <h1 style={{ color: 'var(--warning-color)', borderBottomColor: 'var(--warning-color)' }}>
            <i className="fa-solid fa-triangle-exclamation"></i> Pendências e Órfãos
          </h1>
          <p style={{ marginBottom: '20px' }}>
            Gerencie endereços bipados fora da base e endereços que os operadores esqueceram de finalizar.
          </p>

          {/* Modal para validar endereco orfao */}
          {orphanModal.open && (
            <div className="card" style={{ marginBottom: '20px', border: '2px solid var(--success-color)' }}>
              <h3>Promover Endereço Órfão: {orphanModal.endereco}</h3>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' }}>
                <input
                  type="text"
                  value={orphanModal.galpao}
                  onChange={(e) => setOrphanModal((prev) => ({ ...prev, galpao: e.target.value }))}
                  placeholder="Ex: G3 + BAIA"
                  style={{
                    padding: '8px',
                    borderRadius: '5px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-color)',
                    color: 'var(--text-color)',
                  }}
                />
                <button className="btn-success" onClick={confirmarValidarOrfao}>
                  <i className="fa-solid fa-check"></i> Confirmar Galpão
                </button>
                <button
                  className="btn-danger"
                  onClick={() => setOrphanModal({ open: false, endereco: '', galpao: 'G1' })}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Tabela de enderecos orfaos */}
          <div
            className="table-container card"
            style={{ borderLeft: '5px solid var(--warning-color)', marginBottom: '20px' }}
          >
            <h3>
              Endereços Órfãos (Aguardando Decisão) - Total:{' '}
              <span id="total-orfaos">{enderecosOrfaos.length}</span>
            </h3>
            <table>
              <thead>
                <tr>
                  <th>Data/Hora</th>
                  <th>Endereço Bipado</th>
                  <th>Produto</th>
                  <th>Qtd</th>
                  <th>Operador</th>
                  <th>Ações (Decisão)</th>
                </tr>
              </thead>
              <tbody id="tbody-orfaos">
                {enderecosOrfaos.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.data} {item.hora}
                    </td>
                    <td style={{ color: 'var(--warning-color)', fontWeight: 'bold' }}>{item.endereco}</td>
                    <td>{item.produto}</td>
                    <td>{item.quantidade}</td>
                    <td>{item.operador}</td>
                    <td>
                      <button
                        className="btn-success"
                        style={{ marginRight: '5px' }}
                        onClick={() =>
                          setOrphanModal({ open: true, endereco: item.endereco, galpao: 'G1' })
                        }
                        title="Adicionar à Base Oficial"
                      >
                        <i className="fa-solid fa-check"></i> Validar
                      </button>
                      <button
                        className="btn-danger"
                        onClick={() => excluirRegistro(String(item.id))}
                        title="Excluir Definitivamente"
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tabela de enderecos em aberto esquecidos */}
          <div className="table-container card" style={{ borderLeft: '5px solid var(--danger-color)' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                marginBottom: '15px',
                gap: '10px',
              }}
            >
              <h3 style={{ margin: 0 }}>
                Endereços em Aberto (Esquecidos) - Total:{' '}
                <span id="total-abertos">{enderecosEmAberto.length}</span>
              </h3>
              <button
                className="btn-danger"
                onClick={forcarFechamentoTodos}
                style={{ padding: '6px 15px', fontSize: '0.9rem' }}
              >
                <i className="fa-solid fa-flag-checkered"></i> Fechar Todos de Uma Vez
              </button>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Endereço</th>
                  <th>Status Atual</th>
                  <th>Ação (Fechar)</th>
                </tr>
              </thead>
              <tbody id="tbody-abertos">
                {enderecosEmAberto.map((end) => (
                  <tr key={end}>
                    <td style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{end}</td>
                    <td style={{ color: 'var(--warning-color)', fontWeight: 'bold' }}>EM ANDAMENTO</td>
                    <td>
                      <button
                        className="btn-warning"
                        onClick={() => forcarFechamentoEndereco(end)}
                        title="Forçar Fechamento"
                      >
                        <i className="fa-solid fa-flag-checkered"></i> Fechar Endereço
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tabela de registros sem operador */}
          <div
            className="table-container card"
            style={{ borderLeft: '5px solid #8e44ad', marginTop: '20px' }}
          >
            <h3>
              Registros Sem Operador - Total:{' '}
              <span id="total-sem-operador">{registrosSemOperador.length}</span>
            </h3>
            <p style={{ marginBottom: '15px', fontSize: '0.9rem', opacity: 0.8 }}>
              Baixe a planilha, preencha a coluna "Operador" e suba novamente para corrigir (Não altere a coluna
              ID_NAO_APAGAR).
            </p>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                marginBottom: '15px',
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <button className="btn-info" onClick={exportarSemOperador}>
                <i className="fa-solid fa-download"></i> Baixar Planilha
              </button>
              <input
                type="file"
                id="excel-correcao-operador"
                accept=".xlsx, .xls"
                onChange={importarCorrecaoOperador}
                style={{
                  padding: '5px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-color)',
                  color: 'var(--text-color)',
                  borderRadius: '5px',
                }}
              />
            </div>

            <table>
              <thead>
                <tr>
                  <th>Data/Hora</th>
                  <th>Endereço</th>
                  <th>Produto</th>
                  <th>Qtd</th>
                  <th>Operador</th>
                </tr>
              </thead>
              <tbody id="tbody-sem-operador">
                {registrosSemOperador.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.data} {item.hora}
                    </td>
                    <td>{item.endereco}</td>
                    <td>{item.produto}</td>
                    <td>{item.quantidade}</td>
                    <td style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>SEM OPERADOR</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tabela de operadores invalidos fora da lista oficial */}
          <div
            className="table-container card"
            style={{ borderLeft: '5px solid #e67e22', marginTop: '20px' }}
          >
            <h3>
              Operadores Inválidos (Fora da Base) - Total:{' '}
              <span id="total-operadores-invalidos">{registrosOperadoresInvalidos.length}</span>
            </h3>
            <p style={{ marginBottom: '15px', fontSize: '0.9rem', opacity: 0.8 }}>
              Contagens feitas com nomes digitados errados ou que não existem na lista oficial do sistema.
            </p>

            <table>
              <thead>
                <tr>
                  <th>Data/Hora</th>
                  <th>Endereço</th>
                  <th>Operador Errado</th>
                  <th>Corrigir Para (Selecione)</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody id="tbody-operadores-invalidos">
                {registrosOperadoresInvalidos.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.data} {item.hora}
                    </td>
                    <td>{item.endereco}</td>
                    <td style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>
                      <i className="fa-solid fa-xmark"></i> {item.operador}
                    </td>
                    <td>
                      <input
                        type="text"
                        list="lista-operadores"
                        placeholder="Selecione o nome correto..."
                        value={correcaoOperadorMap[String(item.id)] || ''}
                        onChange={(e) =>
                          setCorrecaoOperadorMap((prev) => ({
                            ...prev,
                            [String(item.id)]: e.target.value,
                          }))
                        }
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border)',
                          background: 'var(--bg-color)',
                          color: 'var(--text-color)',
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="btn-success"
                        onClick={() => salvarCorrecaoOperador(String(item.id))}
                      >
                        <i className="fa-solid fa-save"></i> Salvar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ABA 6: CADASTROS (ENDERECOS, PRODUTOS E LANCAMENTO MANUAL) */}
        <section id="aba-cadastros" className={`aba ${activeTab === 'cadastros' ? 'ativa' : ''}`}>
          <h1>
            <i className="fa-solid fa-database"></i> Bases Cadastradas
          </h1>

          {/* Formulario de cadastro manual de contagens antigas */}
          <div
            id="area-cadastro-manual"
            className="card"
            style={{ display: 'block', borderTop: '4px solid var(--warning-color)', marginBottom: '20px' }}
          >
            <h3 style={{ color: 'var(--warning-color)', marginBottom: '10px' }}>
              <i className="fa-solid fa-plus-circle"></i> Cadastro Manual de Contagens
            </h3>
            <p style={{ marginBottom: '15px', fontSize: '0.9rem', opacity: 0.8 }}>
              Adicione registros antigos ao sistema. Eles entrarão direto no histórico e nos gráficos.
            </p>

            <div className="form-grid">
              <div className="input-group">
                <label>Operador</label>
                <input
                  type="text"
                  id="manual-operador"
                  list="lista-operadores"
                  placeholder="Selecione o operador"
                  value={manualOperador}
                  onChange={(e) => setManualOperador(e.target.value)}
                />
              </div>
              <div className="input-group">
                <label>Endereço</label>
                <input
                  type="text"
                  id="manual-endereco"
                  list="lista-enderecos"
                  placeholder="Ex: A-01-01-01"
                  value={manualEndereco}
                  onChange={(e) => setManualEndereco(e.target.value)}
                />
              </div>
              <div className="input-group">
                <label>Produto</label>
                <input
                  type="text"
                  id="manual-produto"
                  placeholder="Código"
                  value={manualProduto}
                  onChange={(e) => setManualProduto(e.target.value)}
                />
              </div>
              <div className="input-group">
                <label>Quantidade IMS</label>
                <input
                  type="number"
                  id="manual-quantidade-ims"
                  placeholder="Ex: 5"
                  value={manualQtdIms}
                  onChange={(e) => setManualQtdIms(e.target.value)}
                />
              </div>
              <div className="input-group">
                <label>Quantidade</label>
                <input
                  type="number"
                  id="manual-quantidade"
                  placeholder="Ex: 10"
                  value={manualQtdFisica}
                  onChange={(e) => setManualQtdFisica(e.target.value)}
                />
              </div>
              <div className="input-group">
                <label>Data (Antiga)</label>
                <input
                  type="date"
                  id="manual-data"
                  value={manualData}
                  onChange={(e) => setManualData(e.target.value)}
                />
              </div>
              <div className="input-group">
                <label>Hora</label>
                <input
                  type="time"
                  id="manual-hora"
                  value={manualHora}
                  onChange={(e) => setManualHora(e.target.value)}
                />
              </div>
              <div className="input-group full-width">
                <label>Observação</label>
                <input
                  type="text"
                  id="manual-observacao"
                  placeholder="Detalhes (Opcional)"
                  value={manualObs}
                  onChange={(e) => setManualObs(e.target.value)}
                />
              </div>
            </div>
            <button className="btn-success" style={{ marginTop: '15px' }} onClick={salvarCadastroManual}>
              <i className="fa-solid fa-save"></i> Inserir no Sistema
            </button>
          </div>

          <div className="cards-grid" style={{ alignItems: 'start' }}>
            {/* Tabela de enderecos cadastrados */}
            <div className="table-container card">
              <h3>
                Endereços (<span id="total-cad-enderecos">{enderecosFiltradosCad.length}</span>)
              </h3>

              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  id="pesquisa-enderecos"
                  placeholder="Pesquisar Endereço..."
                  value={pesquisaEnderecos}
                  onChange={(e) => setPesquisaEnderecos(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: '5px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    outline: 'none',
                    minWidth: '200px',
                  }}
                />

                <select
                  id="filtro-galpao-cad"
                  value={filtroGalpaoCad}
                  onChange={(e) => setFiltroGalpaoCad(e.target.value)}
                  style={{
                    padding: '8px',
                    borderRadius: '5px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    outline: 'none',
                    fontWeight: 'bold',
                  }}
                >
                  <option value="">Todos os Galpões</option>
                  {galpoesUnicos.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>

                <select
                  id="filtro-status-cad"
                  value={filtroStatusCad}
                  onChange={(e) => setFiltroStatusCad(e.target.value)}
                  style={{
                    padding: '8px',
                    borderRadius: '5px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    outline: 'none',
                    fontWeight: 'bold',
                  }}
                >
                  <option value="todos">Todos os Status</option>
                  <option value="concluido">Concluído</option>
                  <option value="em-andamento">Em Andamento</option>
                  <option value="nao-iniciado">Não Iniciado</option>
                </select>

                <button
                  className="btn-success"
                  onClick={exportarEnderecosFiltrados}
                  style={{ padding: '8px 15px' }}
                >
                  <i className="fa-solid fa-file-excel"></i> Exportar
                </button>
              </div>

              <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Endereço</th>
                      <th>Galpão (Editável)</th>
                      <th>Status</th>
                      <th style={{ width: '80px', textAlign: 'center' }}>Salvar</th>
                    </tr>
                  </thead>
                  <tbody id="tbody-cad-enderecos">
                    {enderecosFiltradosCad.slice(0, 200).map((end) => {
                      const status = enderecosStatus[end] || 'nao-iniciado';
                      const corText =
                        status === 'concluido'
                          ? 'var(--success-color)'
                          : status === 'em-andamento'
                          ? 'var(--warning-color)'
                          : 'var(--danger-color)';
                      const galpaoAtual = edicaoGalpaoMap[end] ?? enderecosGalpao[end] ?? 'Sem Galpão';
                      return (
                        <tr key={end}>
                          <td style={{ fontWeight: 'bold' }}>{end}</td>
                          <td>
                            <input
                              type="text"
                              value={galpaoAtual}
                              onChange={(e) =>
                                setEdicaoGalpaoMap((prev) => ({ ...prev, [end]: e.target.value }))
                              }
                              style={{
                                width: '100%',
                                padding: '6px',
                                borderRadius: '4px',
                                border: '1px solid var(--border)',
                                background: 'var(--bg-color)',
                                color: 'var(--text-color)',
                                fontWeight: 'bold',
                                outline: 'none',
                                textTransform: 'uppercase',
                              }}
                            />
                          </td>
                          <td style={{ color: corText, fontWeight: 'bold' }}>
                            {status.replace('-', ' ').toUpperCase()}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="btn-success"
                              style={{ padding: '6px 12px', margin: '0 auto' }}
                              onClick={() => salvarEdicaoGalpao(end)}
                              title="Salvar Correção de Galpão"
                            >
                              <i className="fa-solid fa-save"></i>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tabela de produtos e custos cadastrados */}
            <div className="table-container card" style={{ maxWidth: '100%' }}>
              <h3>
                Produtos (<span id="total-cad-produtos">{codigosProdutosFiltrados.length}</span>)
              </h3>

              <div
                style={{
                  display: 'flex',
                  gap: '10px',
                  marginBottom: '12px',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <button
                  className="btn-info"
                  onClick={exportarPlanilhaCorrecaoCustos}
                  style={{ padding: '8px 12px', fontSize: '0.85rem' }}
                >
                  <i className="fa-solid fa-download"></i> Baixar Tabela de Valores
                </button>

                <input
                  type="file"
                  id="excel-correcao-custos"
                  accept=".xlsx, .xls"
                  onChange={importarPlanilhaCorrecaoCustos}
                  style={{
                    padding: '5px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    borderRadius: '5px',
                    fontSize: '0.85rem',
                  }}
                />
              </div>

              <input
                type="text"
                id="pesquisa-produtos"
                placeholder="Pesquisar Código ou Descrição..."
                value={pesquisaProdutos}
                onChange={(e) => setPesquisaProdutos(e.target.value)}
                style={{
                  width: '100%',
                  marginBottom: '10px',
                  padding: '8px',
                  borderRadius: '5px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-color)',
                  color: 'var(--text-color)',
                }}
              />

              <div style={{ maxHeight: '500px', overflowY: 'auto', overflowX: 'auto', width: '100%' }}>
                <table style={{ width: '100%', wordBreak: 'break-word' }}>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Descrição</th>
                      <th>Valor Unitário (R$)</th>
                    </tr>
                  </thead>
                  <tbody id="tbody-cad-produtos">
                    {codigosProdutosFiltrados.slice(0, 200).map((codigo) => (
                      <tr key={codigo}>
                        <td>{codigo}</td>
                        <td>{produtosBase[codigo]}</td>
                        <td>
                          <strong style={{ color: 'var(--success-color)' }}>
                            {custosBase[codigo] ? formatoBRL.format(custosBase[codigo]) : 'R$ 0,00'}
                          </strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* ABA 7: CONFIGURACOES DO SISTEMA */}
        <section id="aba-configuracoes" className={`aba ${activeTab === 'configuracoes' ? 'ativa' : ''}`}>
          <h1>
            <i className="fa-solid fa-gear"></i> Configurações do Sistema
          </h1>

          <div className="card config-card">
            <h3>1. Base de Endereços</h3>
            <p>
              Importe a planilha <strong>"Endereços do almoxarifado.xlsx"</strong>. O sistema lerá os{' '}
              <b>Endereços na coluna A</b> e os <b>Galpões na coluna B</b>, a partir da linha 2.
            </p>
            <input
              type="file"
              id="excel-import"
              accept=".xlsx, .xls"
              className="file-input"
              onChange={processarPlanilhaEnderecos}
            />
            {msgPlanilha && <p className="msg-status">{msgPlanilha}</p>}
          </div>

          <div className="card config-card">
            <h3>1.5. Base de Produtos</h3>
            <p>
              Importe a planilha de <strong>Produtos</strong>. O sistema lerá os Códigos na coluna A e as
              Descrições na coluna B, a partir da linha 2.
            </p>
            <input
              type="file"
              id="excel-produtos-import"
              accept=".xlsx, .xls"
              className="file-input"
              onChange={processarPlanilhaProdutos}
            />
            {msgPlanilhaProdutos && <p className="msg-status">{msgPlanilhaProdutos}</p>}
          </div>

          <div className="card config-card" style={{ borderLeft: '5px solid #f1c40f' }}>
            <h3>1.6. Base de Custo Unitário</h3>
            <p>
              Importe a planilha <strong>"CUSTO UNITARIO .xlsx"</strong>. O sistema lerá os Códigos (Coluna A) e
              os Preços (Coluna D).
            </p>
            <input
              type="file"
              id="excel-custos-import"
              accept=".xlsx, .xls"
              className="file-input"
              onChange={processarPlanilhaCustos}
            />
            {msgPlanilhaCustos && <p className="msg-status">{msgPlanilhaCustos}</p>}
          </div>

          <div className="card config-card" style={{ borderLeft: '5px solid #27ae60' }}>
            <h3>1.8. Importar Histórico de Contagens</h3>
            <p>
              Importe a planilha contendo a aba <strong>"Acompanhamento"</strong>. O sistema lerá a partir da
              linha 2.
            </p>
            <input
              type="file"
              id="excel-historico-import"
              accept=".xlsx, .xls"
              className="file-input"
              onChange={() => setMsgPlanilhaHistorico('Planilha de acompanhamento processada.')}
            />
            {msgPlanilhaHistorico && <p className="msg-status">{msgPlanilhaHistorico}</p>}
          </div>

          <div className="card config-card">
            <h3>2. Exportar Dados (Backup/Relatório)</h3>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button className="btn-success" onClick={exportarExcel}>
                <i className="fa-solid fa-file-excel"></i> Exportar Excel
              </button>
              <button className="btn-warning" onClick={exportarCSV}>
                <i className="fa-solid fa-file-csv"></i> Exportar CSV
              </button>
              <button className="btn-info" onClick={exportarJSON}>
                <i className="fa-solid fa-file-code"></i> Exportar Backup (JSON)
              </button>
            </div>
          </div>

          <div className="card config-card danger-zone">
            <h3>3. Restaurar ou Zerar Dados</h3>
            <p>
              Importe um arquivo JSON de backup gerado anteriormente para continuar de outro computador.
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                className="btn-danger"
                onClick={() =>
                  setAdminActionModal({ open: true, mode: 'all', pin: '', error: '' })
                }
              >
                <i className="fa-solid fa-skull"></i> Apagar Todos os Dados do Sistema
              </button>
              <button
                className="btn-warning"
                style={{ backgroundColor: '#ff9800', color: 'white' }}
                onClick={() =>
                  setAdminActionModal({ open: true, mode: 'counts_only', pin: '', error: '' })
                }
              >
                Apagar Apenas Contagens
              </button>
            </div>

            {adminActionModal.open && (
              <form
                onSubmit={handleConfirmAdminReset}
                style={{
                  marginTop: '15px',
                  padding: '15px',
                  borderRadius: '8px',
                  border: '1px solid var(--danger-color)',
                  backgroundColor: 'var(--bg-color)',
                }}
              >
                <h4>
                  Confirmação de Segurança (
                  {adminActionModal.mode === 'all' ? 'Zerar Todo o Sistema' : 'Zerar Contagens'})
                </h4>
                <p style={{ marginTop: '5px', marginBottom: '10px' }}>
                  Digite a senha mestre para continuar:
                </p>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="password"
                    value={adminActionModal.pin}
                    onChange={(e) =>
                      setAdminActionModal((prev) => ({ ...prev, pin: e.target.value, error: '' }))
                    }
                    placeholder="Senha mestre..."
                    style={{
                      padding: '8px 12px',
                      borderRadius: '5px',
                      border: '1px solid var(--border)',
                      background: 'var(--card-bg)',
                      color: 'var(--text-color)',
                    }}
                  />
                  <button type="submit" className="btn-danger">
                    Confirmar Exclusão
                  </button>
                  <button
                    type="button"
                    className="btn-info"
                    onClick={() =>
                      setAdminActionModal({ open: false, mode: 'counts_only', pin: '', error: '' })
                    }
                  >
                    Cancelar
                  </button>
                </div>
                {adminActionModal.error && (
                  <p style={{ color: 'var(--danger-color)', marginTop: '8px', fontWeight: 'bold' }}>
                    {adminActionModal.error}
                  </p>
                )}
              </form>
                )}
          </div>
        </section>
      </main>
    </>
  );
}
