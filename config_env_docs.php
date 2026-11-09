<?php
// arquivo pra centralizar as configs do .env no servidor e documentar o que precisa configurar
// evita deixar chave do firebase e lista de usuario exposta no html

declare(strict_types=1);

// trava acesso direto indevido pelo navegador
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('X-XSS-Protection: 1; mode=block');
header('Referrer-Policy: strict-origin-when-cross-origin');

final class ConfigAmbienteWms
{
    // lista das variaveis que precisam estar no arquivo .env
    public static function listarVariaveis(): array
    {
        return [
            'FIREBASE_API_KEY' => [
                'obrigatorio' => true,
                'descricao'   => 'chave da api do firebase (tirada do front pra nao ficar visivel no inspecionar)',
                'exemplo'     => 'AIzaSyA...',
            ],
            'FIREBASE_PROJECT_ID' => [
                'obrigatorio' => true,
                'descricao'   => 'id do projeto la no firebase onde ficam as colecoes inventario_itens e sistema_wms',
                'exemplo'     => 'almoxarifado-ca3d1',
            ],
            'FIREBASE_AUTH_DOMAIN' => [
                'obrigatorio' => true,
                'descricao'   => 'dominio padrao do projeto no firebase',
                'exemplo'     => 'almoxarifado-ca3d1.firebaseapp.com',
            ],
            'FIREBASE_STORAGE_BUCKET' => [
                'obrigatorio' => true,
                'descricao'   => 'bucket de arquivos do projeto',
                'exemplo'     => 'almoxarifado-ca3d1.firebasestorage.app',
            ],
            'JWT_SECRET' => [
                'obrigatorio' => true,
                'descricao'   => 'chave secreta usada pra assinar o token das rotas da api',
                'exemplo'     => 'chave-aleatoria-grande-aqui',
            ],
            'ADMIN_MASTER_PIN' => [
                'obrigatorio' => true,
                'descricao'   => 'senha mestre pra zerar contagens ou limpar banco nas configuracoes',
                'exemplo'     => '78451296300',
            ],
            'ENCRYPTION_MASTER_KEY' => [
                'obrigatorio' => true,
                'descricao'   => 'chave hex de 64 caracteres pra criptografar dados sensiveis (aes-256-gcm)',
                'exemplo'     => '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            ],
            'RATE_LIMIT_WINDOW_MS' => [
                'obrigatorio' => false,
                'descricao'   => 'tempo da janela do rate limit em ms pra bloquear tentativa de brute force',
                'exemplo'     => '900000',
            ],
            'AUTH_RATE_LIMIT_MAX_ATTEMPTS' => [
                'obrigatorio' => false,
                'descricao'   => 'maximo de tentativas erradas de senha antes de bloquear o ip',
                'exemplo'     => '5',
            ],
        ];
    }

    // le o arquivo .env se estiver rodando em servidor php
    public static function carregarEnv(string $caminho): array
    {
        if (!file_exists($caminho) || !is_readable($caminho)) {
            return [];
        }

        $vars = [];
        $linhas = file($caminho, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($linhas === false) {
            return [];
        }

        foreach ($linhas as $linha) {
            $limpa = trim($linha);
            if ($limpa === '' || str_starts_with($limpa, '#')) {
                continue;
            }
            $partes = explode('=', $limpa, 2);
            if (count($partes) === 2) {
                $chave = trim($partes[0]);
                $valor = trim($partes[1], " \t\n\r\0\x0B\"'");
                putenv("{$chave}={$valor}");
                $_ENV[$chave] = $valor;
                $vars[$chave] = $valor;
            }
        }

        return $vars;
    }

    // funcao auxiliar pra criptografar texto com aes-256-gcm no php
    public static function criptografarDados(string $texto, string $chaveHex): array
    {
        $chave = hex2bin($chaveHex);
        $iv = random_bytes(12);
        $tag = '';
        $cifrado = openssl_encrypt(
            $texto,
            'aes-256-gcm',
            $chave ?: '',
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            '',
            16
        );

        return [
            'iv'    => bin2hex($iv),
            'tag'   => bin2hex($tag),
            'dados' => base64_encode($cifrado ?: ''),
        ];
    }
}

// se rodar pelo terminal mostra o json com a documentacao das variaveis
if (PHP_SAPI === 'cli') {
    echo json_encode(ConfigAmbienteWms::listarVariaveis(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . PHP_EOL;
}
