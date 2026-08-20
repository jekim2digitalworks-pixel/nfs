/**
 * 세 타임존으로 전체 테스트를 돌리고 **결과가 같은지** 확인한다.
 * (테스트계획 §6 #39 · #39-b · T-03)
 *
 * 왜 이게 필요한가:
 *   `TZ=UTC` 로 한 번 통과했다고 존을 아는 코드라는 증명이 되지 않는다.
 *   프로세스 존과 앱 존(KST)이 우연히 같은 답을 내는 경우가 있기 때문이다.
 *   **환경을 세 개로 바꿔도 같은 답이 나와야** 존이 코드에 박혀 있다는 뜻이다.
 *
 *   UTC            Vercel 함수 · GitHub Actions 크론의 실제 환경
 *   Asia/Seoul     개발자 노트북. 여기서만 통과하는 코드가 가장 흔한 사고다
 *   America/New_York  앱 존보다 **뒤에 있는** 존. 날짜 경계가 반대로 어긋난다
 *
 * 왜 셸 스크립트가 아니라 node 인가:
 *   `TZ=... pnpm test` 는 Windows PowerShell 에서 안 먹는다.
 *   개발은 Windows 에서, CI 는 리눅스에서 도는데 러너가 갈리면 한쪽만 돌게 된다.
 *
 * 사용: pnpm test:tz
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TIME_ZONES = ['UTC', 'Asia/Seoul', 'America/New_York'];

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** pnpm 은 Windows 에서 pnpm.cmd 다. shell:true 로 넘겨 양쪽에서 같이 돌게 한다 */
function runTestsIn(timeZone) {
    console.log('');
    console.log('────────────────────────────────────────────');
    console.log(`  TZ=${timeZone}`);
    console.log('────────────────────────────────────────────');

    const childEnvironment = { ...process.env, TZ: timeZone };

    const result = spawnSync('pnpm', ['-r', 'test'], {
        cwd: repositoryRoot,
        env: childEnvironment,
        stdio: 'inherit',
        shell: true,
    });

    if (result.status === 0) {
        return true;
    }
    return false;
}

const failedZones = [];

for (const timeZone of TIME_ZONES) {
    const passed = runTestsIn(timeZone);

    if (!passed) {
        failedZones.push(timeZone);
    }
}

console.log('');
console.log('════════════════════════════════════════════');

if (failedZones.length === 0) {
    console.log(`  ✅ ${TIME_ZONES.length}개 존에서 모두 통과했습니다`);
    console.log('     존을 아는 곳은 packages/domain/time 하나뿐입니다');
    process.exit(0);
}

console.log(`  ❌ 실패한 존: ${failedZones.join(', ')}`);
console.log('     존을 아는 코드가 도메인 밖에 있습니다. raw Date 산술을 먼저 의심하세요');
process.exit(1);
