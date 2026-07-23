# 드론 실기시험 시뮬레이터

드론 1·2종 실기시험의 코스별 훈련과 전체 시험 연습을 위한
브라우저 기반 3D 비행 시뮬레이터입니다.

## 주요 기능

- 1종·2종 시험 및 코스별 훈련 선택
- 기체중량·최대이륙중량 설정
- 조종자 시점과 비행장 전체 미니맵
- 피치·롤·요 자세가 반영되는 3D 헥사콥터
- 키보드와 Gamepad API 기반 USB 조종기 입력
- 라바콘 하강풍 반응 및 단계별 목표 안내
- 데스크톱·모바일 반응형 화면

## 키보드 조작

- `W` / `S`: 상승 / 하강
- `A` / `D`: 러더 좌회전 / 우회전
- 방향키 위 / 아래: 전진 / 후진
- 방향키 왼쪽 / 오른쪽: 좌측 / 우측 이동

## GitHub Pages 배포

`main` 브랜치에 변경사항이 올라오면 GitHub Actions가 정적 앱을
자동으로 빌드하고 GitHub Pages에 배포합니다.

로컬에서 GitHub Pages용 결과물을 확인하려면 다음 명령을 사용합니다.

```bash
npm ci
npm run build:pages
npm run preview:pages
```

기본 배포 주소는 다음과 같습니다.

```text
https://unclegeenie.github.io/drone/
```
