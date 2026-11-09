import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
} from 'firebase/firestore';

dotenv.config();

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'wms-eletra-secret-key-2026';
const ENCRYPTION_KEY =
  process.env.ENCRYPTION_MASTER_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ADMIN_MASTER_PIN = process.env.ADMIN_MASTER_PIN || '78451296300';

// limpa caracteres perigosos pra evitar xss nos campos digitados
function limparTexto(val: unknown, maxLen = 200): string {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/<[^>]*>?/gm, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLen);
}

// criptografa dados sensiveis com aes-256-gcm
function criptografarPayload(texto: string, chaveHex: string) {
  const key = Buffer.from(chaveHex.padEnd(64, '0').slice(0, 64), 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    alg: 'AES-256-GCM' as const,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: enc.toString('base64'),
    timestamp: Date.now(),
  };
}

// compara a senha mestre sem dar brecha pra timing attack
function conferirSenhaAdmin(digitada: string, correta: string): boolean {
  const salt = 'wms-eletra-salt';
  const h1 = crypto.pbkdf2Sync(String(digitada), salt, 10000, 32, 'sha256');
  const h2 = crypto.pbkdf2Sync(String(correta), salt, 10000, 32, 'sha256');
  if (h1.length !== h2.length) return false;
  return crypto.timingSafeEqual(h1, h2);
}

// gera token simples pra proteger as rotas da api
function gerarTokenSessao(secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      sub: 'wms-eletra',
      exp: Math.floor(Date.now() / 1000) + 86400,
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function validarTokenSessao(token: string, secret: string): boolean {
  try {
    const p = token.split('.');
    if (p.length !== 3) return false;
    const sigEsperada = crypto
      .createHmac('sha256', secret)
      .update(`${p[0]}.${p[1]}`)
      .digest('base64url');
    const b1 = Buffer.from(p[2]);
    const b2 = Buffer.from(sigEsperada);
    if (b1.length !== b2.length || !crypto.timingSafeEqual(b1, b2)) return false;
    const payload = JSON.parse(Buffer.from(p[1], 'base64url').toString('utf8'));
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

// controle simples de tentativas por ip pra travar brute force
const controleIps = new Map<
  string,
  { reqs: number; resetEm: number; errosSenha: number; bloqueadoAte: number }
>();

function checarRateLimit(ip: string) {
  const agora = Date.now();
  const janela = Number(process.env.RATE_LIMIT_WINDOW_MS || 900000);
  const maxReqs = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 250);

  let item = controleIps.get(ip);
  if (!item || agora > item.resetEm) {
    item = { reqs: 0, resetEm: agora + janela, errosSenha: 0, bloqueadoAte: 0 };
    controleIps.set(ip, item);
  }

  if (item.bloqueadoAte > agora) {
    return { ok: false, esperaSeg: Math.ceil((item.bloqueadoAte - agora) / 1000) };
  }

  item.reqs += 1;
  if (item.reqs > maxReqs) {
    return { ok: false, esperaSeg: Math.ceil((item.resetEm - agora) / 1000) };
  }

  return { ok: true, esperaSeg: 0 };
}

function registrarErroSenha(ip: string) {
  const agora = Date.now();
  const maxTentativas = Number(process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS || 5);
  const tempoBloqueio = Number(process.env.AUTH_LOCKOUT_DURATION_MS || 300000);

  let item = controleIps.get(ip);
  if (!item) {
    item = { reqs: 1, resetEm: agora + 900000, errosSenha: 0, bloqueadoAte: 0 };
    controleIps.set(ip, item);
  }

  item.errosSenha += 1;
  if (item.errosSenha >= maxTentativas) {
    item.bloqueadoAte = agora + tempoBloqueio;
    return { bloqueado: true, esperaSeg: Math.ceil(tempoBloqueio / 1000) };
  }
  return { bloqueado: false, esperaSeg: 0 };
}

// conexao com o firebase puxando as chaves do .env pra nao expor no front
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyACE44-gqNuhkZsS1F-ginI0UFLDlznP0A',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'almoxarifado-ca3d1.firebaseapp.com',
  projectId: process.env.FIREBASE_PROJECT_ID || 'almoxarifado-ca3d1',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'almoxarifado-ca3d1.firebasestorage.app',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '714541348140',
  appId: process.env.FIREBASE_APP_ID || '1:714541348140:web:d3403407fa0e2084af2889',
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || 'G-4ZQBMV0DDV',
};

const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(firebaseApp);

// lista de operadores e turnos fica aqui no servidor pra nao ficar aberta no html
const LISTA_OPERADORES: string[] = [
  'antonio.junior', 'anderson.marques', 'anderson.lima', 'carlos.henrique', 'fernando.pinheiro',
  'giovanni.martins', 'juan.teixeira', 'julio.barroso', 'kelvia.lopes', 'leandro.lima',
  'maria.serra', 'raiane.dantas', 'raylane.lopes', 'thainara.gomes', 'odair.xavier',
  'gustavo.damasceno', 'janiele.ferreira', 'gabriel.vieira', 'suely.lima', 'erivaldo.sa',
  'kelly.castro', 'alexandre.silva', 'antonio.mauricio', 'francisco.taymison', 'guilherme.alves',
  'isabele.morais', 'marcos.vinicius', 'maria.monica', 'mateus.carmo', 'jose.oliveira',
  'jocelio.nunes', 'alison.rocha', 'caio.silva', 'rian.gledson', 'bruno.marinho', 'joao.igo',
  'victor.costa', 'mayara.moura', 'odilano.vieira', 'joao.filho', 'flavio.silva',
  'erikellyson.franga', 'mikael.pereira', 'wedson.lopes', 'denise.teodosio', 'brendo.oliveira',
  'liardson.falcao', 'claudecir.assuncao', 'gabriel.carneiro', 'gleydson.lopes', 'anderson.rodrigues', 'renato.martins',
];

const MAPA_TURNOS: Record<string, string> = {
  'antonio.junior': 'Turno 1', 'anderson.marques': 'Turno 1', 'anderson.lima': 'COMERCIAL',
  'carlos.henrique': 'Turno 1', 'fernando.pinheiro': 'Turno 1', 'giovanni.martins': 'Turno 1',
  'juan.teixeira': 'Turno 1', 'julio.barroso': 'COMERCIAL', 'kelvia.lopes': 'Turno 1',
  'leandro.lima': 'COMERCIAL', 'maria.serra': 'COMERCIAL', 'raiane.dantas': 'COMERCIAL',
  'raylane.lopes': 'COMERCIAL', 'thainara.gomes': 'Turno 1', 'odair.xavier': 'Turno 1',
  'gustavo.damasceno': 'Turno 1', 'janiele.ferreira': 'Turno 1', 'gabriel.vieira': 'COMERCIAL',
  'suely.lima': 'COMERCIAL', 'erivaldo.sa': 'COMERCIAL', 'kelly.castro': 'Turno 2',
  'alexandre.silva': 'Turno 2', 'antonio.mauricio': 'Turno 2', 'francisco.taymison': 'COMERCIAL',
  'guilherme.alves': 'Turno 2', 'isabele.morais': 'Turno 2', 'marcos.vinicius': 'Turno 2',
  'maria.monica': 'Turno 2', 'mateus.carmo': 'Turno 2', 'jose.oliveira': 'Turno 2',
  'jocelio.nunes': 'Turno 1', 'alison.rocha': 'Turno 3', 'caio.silva': 'Turno 3',
  'rian.gledson': 'Turno 3', 'bruno.marinho': 'Turno 3', 'joao.igo': 'Turno 1',
  'victor.costa': 'COMERCIAL', 'mayara.moura': 'COMERCIAL', 'odilano.vieira': 'COMERCIAL',
  'joao.filho': 'Turno 2', 'flavio.silva': 'Turno 1', 'erikellyson.franga': 'COMERCIAL',
  'mikael.pereira': 'Turno 2', 'wedson.lopes': 'Turno 1', 'denise.teodosio': 'COMERCIAL',
  'brendo.oliveira': 'Turno 1', 'liardson.falcao': 'COMERCIAL', 'claudecir.assuncao': 'Turno 2',
  'gabriel.carneiro': 'Turno 2', 'gleydson.lopes': 'COMERCIAL', 'anderson.rodrigues': 'Turno 2',
  'renato.martins': 'Turno 1',
};

interface RegistroInventario {
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
  excluido?: boolean;
  encryptedMeta?: unknown;
}

// variaveis em memoria sincronizadas com o firestore
let sessaoAtual = 'Inventário Almoxarifado Eletra';
let enderecos: string[] = [];
let enderecosStatus: Record<string, string> = {};
let enderecosGalpao: Record<string, string> = {};
let produtosBase: Record<string, string> = {};
let custosBase: Record<string, number> = {};
let inventario: RegistroInventario[] = [];
let ultimoSyncServidor = 0;
let primeiraCargaFeita = false;

// puxa os dados do firebase (na primeira vez traz tudo, dps traz so o que mudou)
async function sincronizarFirebase(): Promise<void> {
  try {
    if (!primeiraCargaFeita) {
      const [
        snapItens,
        docEnderecos,
        docStatus,
        docGalpao,
        docProdutos,
        docCustos,
      ] = await Promise.all([
        getDocs(collection(db, 'inventario_itens')),
        getDoc(doc(db, 'sistema_wms', 'enderecosWMS')),
        getDoc(doc(db, 'sistema_wms', 'enderecosStatusWMS')),
        getDoc(doc(db, 'sistema_wms', 'enderecosGalpaoWMS')),
        getDoc(doc(db, 'sistema_wms', 'produtosWMS')),
        getDoc(doc(db, 'sistema_wms', 'custosWMS')),
      ]);

      const itensCarregados: RegistroInventario[] = [];
      snapItens.forEach((d) => {
        const dados = d.data() as RegistroInventario;
        if (!dados.excluido) {
          itensCarregados.push(dados);
        }
      });

      if (itensCarregados.length > 0) {
        inventario = itensCarregados;
      } else {
        // caso ainda esteja no formato antigo dentro de sistema_wms
        const docAntigo = await getDoc(doc(db, 'sistema_wms', 'inventarioWMS'));
        if (docAntigo.exists() && docAntigo.data()?.dadosSalvos) {
          const listaAntiga = JSON.parse(docAntigo.data().dadosSalvos);
          if (Array.isArray(listaAntiga)) {
            inventario = listaAntiga;
          }
        }
      }

      if (docEnderecos.exists() && docEnderecos.data()?.dadosSalvos) {
        enderecos = JSON.parse(docEnderecos.data().dadosSalvos);
      }
      if (docStatus.exists() && docStatus.data()?.dadosSalvos) {
        enderecosStatus = JSON.parse(docStatus.data().dadosSalvos);
      }
      if (docGalpao.exists() && docGalpao.data()?.dadosSalvos) {
        enderecosGalpao = JSON.parse(docGalpao.data().dadosSalvos);
      }
      if (docProdutos.exists() && docProdutos.data()?.dadosSalvos) {
        produtosBase = JSON.parse(docProdutos.data().dadosSalvos);
      }
      if (docCustos.exists() && docCustos.data()?.dadosSalvos) {
        custosBase = JSON.parse(docCustos.data().dadosSalvos);
      }

      inventario.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      ultimoSyncServidor = Date.now();
      primeiraCargaFeita = true;
    } else {
      const qNovos = query(
        collection(db, 'inventario_itens'),
        where('ultimaModificacao', '>', ultimoSyncServidor - 5000)
      );
      const snapNovos = await getDocs(qNovos);
      if (!snapNovos.empty) {
        const mapa = new Map<string, RegistroInventario>();
        inventario.forEach((i) => mapa.set(String(i.id), i));
        snapNovos.forEach((d) => {
          const dados = d.data() as RegistroInventario;
          if (dados.excluido) {
            mapa.delete(String(dados.id));
          } else {
            mapa.set(String(dados.id), dados);
          }
        });
        inventario = Array.from(mapa.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        ultimoSyncServidor = Date.now();
      }
    }
  } catch (err) {
    console.error('Erro ao sincronizar com o Firebase:', err);
  }
}

async function salvarDocumentoWms(chave: string, dados: unknown): Promise<void> {
  if (chave === 'inventarioWMS' && Array.isArray(dados)) {
    for (let i = 0; i < dados.length; i += 400) {
      const lote = writeBatch(db);
      const pedaco = dados.slice(i, i + 400);
      pedaco.forEach((item: RegistroInventario) => {
        item.ultimaModificacao = Date.now();
        lote.set(doc(db, 'inventario_itens', String(item.id)), item);
      });
      await lote.commit();
    }
    ultimoSyncServidor = Date.now();
    return;
  }

  await setDoc(doc(db, 'sistema_wms', chave), {
    dadosSalvos: JSON.stringify(dados),
  });
}

async function startServer() {
  await sincronizarFirebase();

  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // headers basicos de seguranca
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // aplica o rate limit nas rotas da api
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';
    const check = checarRateLimit(ip);
    if (!check.ok) {
      res.status(429).json({
        error: `Muitas requisicoes seguidas. Aguarde ${check.esperaSeg}s.`,
      });
      return;
    }
    next();
  });

  // gera token pro front conversar com o back sem precisar de tela de login
  app.post('/api/auth/session-token', (_req: Request, res: Response) => {
    const token = gerarTokenSessao(JWT_SECRET);
    res.json({ token });
  });

  // middleware que confere o token nas rotas
  const exigirToken = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Token ausente.' });
      return;
    }
    const token = authHeader.slice(7);
    if (!validarTokenSessao(token, JWT_SECRET)) {
      res.status(401).json({ error: 'Token invalido ou expirado.' });
      return;
    }
    next();
  };

  // rota inicial que entrega os dados pro sistema abrir
  app.get('/api/wms/bootstrap', exigirToken, async (_req: Request, res: Response) => {
    await sincronizarFirebase();

    res.json({
      sessaoAtual,
      enderecos,
      enderecosStatus,
      enderecosGalpao,
      produtosBase,
      custosBase,
      inventario,
      operators: LISTA_OPERADORES,
      shifts: MAPA_TURNOS,
      shiftMap: MAPA_TURNOS,
    });
  });

  // salva uma contagem nova ou editada la no firebase
  app.post('/api/wms/inventario', exigirToken, async (req: Request, res: Response) => {
    const body = req.body || {};
    const id = limparTexto(body.id || Date.now().toString(), 80);
    const operador = limparTexto(body.operador, 80);
    const endereco = limparTexto(body.endereco, 80);
    const produto = limparTexto(body.produto, 80);
    const observacao = limparTexto(body.observacao, 250);
    const sessao = limparTexto(body.sessao || sessaoAtual, 100);

    const quantidadeIms: number | '' =
      body.quantidadeIms === '' || body.quantidadeIms === undefined || body.quantidadeIms === null
        ? ''
        : Number(body.quantidadeIms);
    const quantidade: number | '' =
      body.quantidade === '' || body.quantidade === undefined || body.quantidade === null
        ? ''
        : Number(body.quantidade);

    if (!operador || !endereco) {
      res.status(400).json({ error: 'Preencha Operador e Endereco.' });
      return;
    }

    const agora = new Date();
    const timestampAtual = Number(body.timestamp) || agora.getTime();

    const encryptedMeta = criptografarPayload(
      JSON.stringify({ operador, endereco, produto, quantidadeIms, quantidade, observacao }),
      ENCRYPTION_KEY
    );

    const registro: RegistroInventario = {
      id,
      sessao,
      operador,
      endereco,
      produto,
      quantidadeIms,
      quantidade,
      observacao,
      data: body.data ? limparTexto(body.data, 30) : agora.toLocaleDateString('pt-BR'),
      hora: body.hora ? limparTexto(body.hora, 30) : agora.toLocaleTimeString('pt-BR'),
      timestamp: timestampAtual,
      ultimaModificacao: Date.now(),
      encryptedMeta,
    };

    await setDoc(doc(db, 'inventario_itens', String(registro.id)), registro);

    const idx = inventario.findIndex((i) => String(i.id) === String(id));
    if (idx !== -1) {
      inventario[idx] = registro;
    } else {
      inventario.push(registro);
    }

    if (enderecos.includes(endereco)) {
      enderecosStatus[endereco] = 'concluido';
      await salvarDocumentoWms('enderecosStatusWMS', enderecosStatus);
    }

    ultimoSyncServidor = Date.now();
    res.json({ record: registro, enderecosStatus });
  });

  // exclui um item marcando excluido=true igual no script original
  app.delete('/api/wms/inventario/:id', exigirToken, async (req: Request, res: Response) => {
    const id = limparTexto(req.params.id, 80);
    await setDoc(doc(db, 'inventario_itens', String(id)), {
      id: String(id),
      excluido: true,
      ultimaModificacao: Date.now(),
    });

    inventario = inventario.filter((i) => String(i.id) !== String(id));
    ultimoSyncServidor = Date.now();
    res.json({ deletedId: id });
  });

  // sincroniza alteracoes nas bases de enderecos, galpoes, produtos e custos
  app.post('/api/wms/sync-bases', exigirToken, async (req: Request, res: Response) => {
    const body = req.body || {};

    if (Array.isArray(body.enderecos)) {
      enderecos = body.enderecos;
      await salvarDocumentoWms('enderecosWMS', enderecos);
    }
    if (body.enderecosWMS && Array.isArray(body.enderecosWMS)) {
      enderecos = body.enderecosWMS;
      await salvarDocumentoWms('enderecosWMS', enderecos);
    }
    if (body.enderecosStatus && typeof body.enderecosStatus === 'object') {
      enderecosStatus = body.enderecosStatus;
      await salvarDocumentoWms('enderecosStatusWMS', enderecosStatus);
    }
    if (body.enderecosStatusWMS && typeof body.enderecosStatusWMS === 'object') {
      enderecosStatus = body.enderecosStatusWMS;
      await salvarDocumentoWms('enderecosStatusWMS', enderecosStatus);
    }
    if (body.enderecosGalpao && typeof body.enderecosGalpao === 'object') {
      enderecosGalpao = body.enderecosGalpao;
      await salvarDocumentoWms('enderecosGalpaoWMS', enderecosGalpao);
    }
    if (body.enderecosGalpaoWMS && typeof body.enderecosGalpaoWMS === 'object') {
      enderecosGalpao = body.enderecosGalpaoWMS;
      await salvarDocumentoWms('enderecosGalpaoWMS', enderecosGalpao);
    }
    if (body.produtosBase && typeof body.produtosBase === 'object') {
      produtosBase = body.produtosBase;
      await salvarDocumentoWms('produtosWMS', produtosBase);
    }
    if (body.custosBase && typeof body.custosBase === 'object') {
      custosBase = body.custosBase;
      await salvarDocumentoWms('custosWMS', custosBase);
    }

    res.json({ ok: true });
  });

  // rota protegida por senha pra zerar apenas contagens ou todo o sistema
  app.post('/api/wms/admin/reset', exigirToken, async (req: Request, res: Response) => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';
    const adminPin = String(req.body?.adminPin || '').trim();
    const mode = limparTexto(req.body?.mode || 'counts_only', 30);

    if (!conferirSenhaAdmin(adminPin, ADMIN_MASTER_PIN)) {
      const erro = registrarErroSenha(ip);
      res.status(403).json({
        error: erro.bloqueado
          ? `Muitas tentativas erradas. Bloqueado por ${erro.esperaSeg}s.`
          : 'Senha incorreta!',
      });
      return;
    }

    if (mode === 'all') {
      await Promise.all([
        deleteDoc(doc(db, 'sistema_wms', 'enderecosWMS')),
        deleteDoc(doc(db, 'sistema_wms', 'enderecosStatusWMS')),
        deleteDoc(doc(db, 'sistema_wms', 'enderecosGalpaoWMS')),
        deleteDoc(doc(db, 'sistema_wms', 'sessaoWMS')),
      ]);

      for (let i = 0; i < inventario.length; i += 400) {
        const lote = writeBatch(db);
        const pedaco = inventario.slice(i, i + 400);
        pedaco.forEach((item) => {
          lote.delete(doc(db, 'inventario_itens', String(item.id)));
        });
        await lote.commit();
      }

      inventario = [];
      enderecos = [];
      enderecosStatus = {};
      enderecosGalpao = {};
      res.json({ message: 'Todos os dados foram apagados com sucesso!' });
    } else {
      for (let i = 0; i < inventario.length; i += 400) {
        const lote = writeBatch(db);
        const pedaco = inventario.slice(i, i + 400);
        pedaco.forEach((item) => {
          lote.delete(doc(db, 'inventario_itens', String(item.id)));
        });
        await lote.commit();
      }

      inventario = [];
      enderecosStatus = {};
      await salvarDocumentoWms('enderecosStatusWMS', enderecosStatus);
      res.json({ message: 'Historico de contagens apagado e status reiniciados!' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
}

startServer();
