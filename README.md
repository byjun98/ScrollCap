<div align="center">

# ScrollCap

**Chrome MV3 스크롤 캡처 확장 프로그램 — 보이는 화면, 전체 페이지, 선택 영역 캡처와 에디터 기반 크롭·저장**

TypeScript · Chrome Extensions MV3 · Vite · esbuild · IndexedDB · Canvas 2D

[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Build](https://img.shields.io/badge/Build-esbuild-FFCF00?logo=esbuild&logoColor=111111)](https://esbuild.github.io/)
[![Storage](https://img.shields.io/badge/Storage-IndexedDB%20%2B%20chrome.storage-4CAF50)](https://developer.chrome.com/docs/extensions/reference/api/storage)

</div>

---

## 목차

- [프로젝트 소개](#-프로젝트-소개)
- [주요 기능 미리보기](#-주요-기능-미리보기)
- [시스템 아키텍처](#-시스템-아키텍처)
- [기술 스택 & 선택 이유](#-기술-스택--선택-이유)
- [핵심 기능 상세](#-핵심-기능-상세)
  - [1. 캡처 오케스트레이션](#1-캡처-오케스트레이션)
  - [2. 선택 영역 캡처와 자동 스크롤](#2-선택-영역-캡처와-자동-스크롤)
  - [3. 에디터 스티칭 · 크롭 · 내보내기](#3-에디터-스티칭--크롭--내보내기)
  - [4. 설정 · 저장 규칙 · 단축키](#4-설정--저장-규칙--단축키)
  - [5. MV3 권한 모델과 저장 구조](#5-mv3-권한-모델과-저장-구조)
- [어려웠던 점과 해결](#-어려웠던-점과-해결)
- [배운 점](#-배운-점)
- [정량 지표](#-정량-지표)
- [구현 범위](#-구현-범위)
- [프로젝트 구조](#-프로젝트-구조)
- [실행 방법](#-실행-방법)
- [권한과 단축키](#-권한과-단축키)
- [알려진 한계](#-알려진-한계)

---

## 프로젝트 소개

ScrollCap은 GoFullPage, FireShot 계열의 사용 경험을 목표로 만든 **Chrome MV3 기반 스크롤 캡처 확장 프로그램**입니다.

단순히 화면을 한 번 저장하는 수준이 아니라, **현재 화면 캡처 → 전체 페이지 자동 스크롤 캡처 → 선택 영역 캡처 → 에디터에서 스티칭/크롭/저장**까지 한 흐름으로 이어지도록 설계했습니다.

브라우저 확장 형태이지만 구조적으로는 작은 클라이언트 애플리케이션에 가깝습니다. 사용자의 액션에 따라 작업 상태가 전이되고, 여러 비동기 프레임 수집 결과를 후처리 규칙에 맞게 정리한 뒤 최종 결과물로 내보내는 흐름을 중심에 두었습니다.

특히 이 프로젝트는 확장 프로그램 특유의 제약을 전제로, 다음 문제를 직접 해결하는 데 초점을 맞췄습니다.

- `service worker`와 `content script`를 분리한 MV3 구조
- 긴 페이지를 여러 프레임으로 나눠 캡처하는 스크롤 오케스트레이션
- 선택 영역 드래그 중 자동 스크롤
- `fixed/sticky` 요소 중복 문제 완화
- 에디터 내 크롭 미리보기, 되돌리기/다시하기, PNG/JPEG 저장
- 파일명 템플릿, 자동 저장 하위 폴더, 대용량 분할 저장 같은 실사용 설정

---

## 주요 기능 미리보기

| 화면 | 스크린샷 | 설명 |
| --- | --- | --- |
| **팝업** | <img src="./docs/1.png" width="240" alt="ScrollCap popup" /> | 현재 화면, 전체 페이지, 선택 영역 캡처를 즉시 시작하고 최근 캡처 에디터 이동/설정 진입까지 한 번에 처리합니다. |
| **에디터** | <img src="./docs/2.png" width="360" alt="ScrollCap editor" /> | 이어 붙인 결과를 확인하고 크롭, 되돌리기/다시하기, PNG/JPEG 저장까지 진행할 수 있습니다. |

---

## 시스템 아키텍처

```text
┌────────────────────────────────────────────────────────────┐
│                         Popup UI                           │
│                                                            │
│   현재 화면 캡처 / 전체 페이지 캡처 / 선택 영역 캡처 / 설정  │
└──────────────────────────────┬─────────────────────────────┘
                               │ message passing
                               ▼
┌────────────────────────────────────────────────────────────┐
│               Background Service Worker (MV3)              │
│                                                            │
│  - 캡처 세션 시작/종료                                     │
│  - 현재 탭 메타데이터 수집                                 │
│  - 프레임별 scrollTo → captureVisibleTab 실행              │
│  - 캡처 기록 저장 및 에디터 탭 열기                        │
└───────────────┬───────────────────────────────┬────────────┘
                │                               │
                │                               │
                ▼                               ▼
┌──────────────────────────────┐   ┌─────────────────────────┐
│       Content Script         │   │      Storage Layer      │
│                              │   │                         │
│ - 페이지 크기 측정           │   │ - chrome.storage.local  │
│ - 자동 스크롤                │   │   캡처 메타데이터       │
│ - 선택 영역 UI               │   │ - IndexedDB             │
│ - fixed/sticky 숨김          │   │   이미지 프레임 자산    │
└───────────────┬──────────────┘   └────────────┬────────────┘
                │                               │
                └───────────────┬───────────────┘
                                ▼
┌────────────────────────────────────────────────────────────┐
│                        Editor UI                           │
│                                                            │
│  - 프레임 스티칭                                            │
│  - 크롭 박스 조정                                            │
│  - 미리보기 반영                                             │
│  - Undo / Redo                                              │
│  - PNG / JPEG 저장                                          │
│  - 파일명 규칙 / 폴더 / 대용량 분할 옵션 반영               │
└────────────────────────────────────────────────────────────┘
```

---

## 기술 스택 & 선택 이유

| 기술 | 선택 이유 |
| --- | --- |
| **Chrome Extensions MV3** | Chrome Web Store 배포를 전제로 한 최신 확장 구조입니다. 백그라운드 로직이 이벤트 기반 `service worker`로 이동한 환경에서, 짧은 작업 세션을 안정적으로 이어 붙이는 구조가 중요했습니다. |
| **TypeScript** | `service worker`, `content script`, `editor`, `settings`가 모두 메시지와 상태를 주고받기 때문에 타입 안정성이 중요했습니다. 작업 상태와 이벤트 흐름이 분산된 구조일수록 타입 정보가 유지보수성을 크게 좌우합니다. |
| **Vite + esbuild 빌드 스크립트** | 개발 중에는 빠른 TypeScript 워크플로를 유지하고, 실제 확장 배포물은 `dist`에 안정적인 파일명으로 생성하도록 분리했습니다. |
| **Vanilla UI + Canvas 2D** | React를 얹기보다 MV3의 경량성, 빠른 로드, 캔버스 중심 편집 흐름에 집중하는 쪽이 유리했습니다. 실시간 도구형 UI에서 입력 반응성과 후처리 흐름을 단순하게 유지하기 좋았습니다. |
| **IndexedDB + chrome.storage** | 큰 이미지 프레임은 IndexedDB에, 캡처 메타데이터와 설정은 `chrome.storage`에 분리 저장해 실사용 안정성을 확보했습니다. 대용량 리소스와 경량 상태 데이터를 분리해 다루는 구조를 의도했습니다. |
| **Chrome APIs (`tabs`, `scripting`, `downloads`, `commands`)** | 캡처, 스크립트 주입, 저장, 단축키 등 확장 프로그램 핵심 기능이 모두 여기에 묶여 있습니다. |

---

## 핵심 기능 상세

### 1. 캡처 오케스트레이션

<details>
<summary><b>기술 상세 펼치기</b></summary>

ScrollCap의 핵심은 브라우저 전체를 한 번에 캡처하는 것이 아니라, **현재 보이는 뷰포트를 여러 번 캡처한 뒤 스티칭 가능한 데이터로 축적하는 것**입니다.

전체 페이지 캡처 흐름은 다음과 같습니다.

```text
사용자 클릭
   ↓
Popup → Service Worker 메시지 전송
   ↓
content script로 페이지 metrics 수집
   ↓
scrollHeight / viewportHeight 기준 캡처 위치 목록 계산
   ↓
각 위치마다 scrollTo → settle 대기 → captureVisibleTab
   ↓
타일 메타데이터와 이미지 프레임 저장
   ↓
Editor 탭 오픈
```

이 구조를 택한 이유는 MV3의 `service worker`가 DOM을 직접 다룰 수 없기 때문입니다. 실제 스크롤과 선택 UI는 `content script`가 맡고, 전체 세션 제어와 저장은 `service worker`가 담당합니다.

결과적으로 이 레이어는 단순 유틸리티 함수 묶음이 아니라, 입력 이벤트에 따라 `ready → capturing → stitching → ready/failed`로 상태가 전이되는 작업 세션 관리 계층 역할을 합니다.

핵심 포인트:

- 보이는 영역 캡처는 1프레임으로 종료
- 전체 페이지 캡처는 overlap을 둔 여러 프레임 생성
- 선택 영역 캡처는 선택 rect 기준으로 필요한 프레임만 수집
- 캡처 도중 실패하면 레코드 상태를 `failed`로 남겨 디버깅 가능

</details>

### 2. 선택 영역 캡처와 자동 스크롤

<details>
<summary><b>기술 상세 펼치기</b></summary>

선택 영역 캡처는 단순히 드래그 박스를 그리는 게 아니라, **드래그 중 페이지 끝에 닿으면 자동으로 스크롤이 이어지는 UX**를 목표로 구현했습니다.

```text
Selection Capture 시작
   ↓
content script가 페이지 위에 선택 UI 오버레이 삽입
   ↓
pointer down → drag 시작
   ↓
포인터가 viewport 상/하단 margin에 접근
   ↓
requestAnimationFrame 기반 auto-scroll
   ↓
문서 좌표계 기준 선택 rect 갱신
   ↓
손을 떼면 최종 rect 확정
```

이 흐름 덕분에 사용자는 긴 페이지에서도 드래그를 끊지 않고 원하는 영역을 계속 확장할 수 있습니다.

추가 보정:

- 캡처 전에 `fixed/sticky` 요소를 숨겨 중복 노출 완화
- 선택 캡처 결과는 타일별 `cropLeft`, `cropRight`, `cropTop`, `cropBottom` 메타데이터를 함께 저장
- 이후 에디터가 실제 선택 폭만 정확히 이어 붙임

</details>

### 3. 에디터 스티칭 · 크롭 · 내보내기

<details>
<summary><b>기술 상세 펼치기</b></summary>

에디터는 단순 뷰어가 아니라, **캡처 결과를 최종 산출물로 바꾸는 후처리 단계**입니다.

핵심 기능:

- 여러 프레임을 최종 캔버스로 이어 붙이기
- 크롭 박스 생성/이동
- 크롭 완료 후 미리보기 즉시 반영
- `Undo` / `Redo`
- `Ctrl+Z` / `Ctrl+Y`
- PNG / JPEG 저장

편집 흐름은 이렇게 정리됩니다.

```text
프레임 로드
   ↓
스티칭 또는 단일 이미지 표시
   ↓
Crop 모드 진입
   ↓
박스 조정 + 가장자리 auto-scroll
   ↓
Done Crop
   ↓
미리보기에 반영
   ↓
내보내기
```

대용량 저장도 고려했습니다.

- 설정에서 `20MB 이상이면 여러 파일로 나누기`를 켜면
- 전체/선택 캡처 결과가 큰 경우 세로 기준으로 분할 저장
- 파일명에는 `part-01`, `part-02` 같은 suffix가 붙음

</details>

### 4. 설정 · 저장 규칙 · 단축키

<details>
<summary><b>기술 상세 펼치기</b></summary>

ScrollCap은 캡처만 되는 데서 끝나지 않고, 반복 사용을 전제로 저장 규칙을 사용자화할 수 있게 만들었습니다.

현재 지원하는 설정:

- 저장 전에 위치와 이름 확인
- 파일명에 크롭 크기 포함
- 캡처 전에 `fixed/sticky` 숨기기
- 파일 이름 형식 템플릿
- 자동 저장 하위 폴더
- 20MB 이상 결과 분할 저장
- 단축키 확인 및 Chrome 단축키 설정 페이지 이동

파일명 템플릿에서 지원하는 토큰:

```text
{title} {captureId} {date} {time} {host} {kind} {width} {height}
```

예시:

```text
{host}-{date}-{kind}
→ www_naver_com-2026-04-08-scroll-tab.png
```

자동 저장 경로는 Chrome 제약상 임의 절대경로가 아니라, **다운로드 폴더 하위 경로**만 지정합니다.

설정 파트는 단순 체크박스 모음보다, 사용자가 결과물을 어떤 규칙으로 정리하고 축적할지 정의하는 작은 규칙 시스템에 가깝게 설계했습니다.

기본 단축키:

- `Ctrl+Shift+7`: 현재 화면 캡처
- `Ctrl+Shift+8`: 전체 페이지 캡처
- `Ctrl+Shift+9`: 선택 영역 캡처
- `Ctrl+Shift+0`: 팝업 열기

</details>

### 5. MV3 권한 모델과 저장 구조

<details>
<summary><b>기술 상세 펼치기</b></summary>

확장 프로그램은 가능한 한 적은 권한으로 설계했습니다.

현재 사용 권한:

- `activeTab`
- `scripting`
- `storage`
- `downloads`

설계 의도:

- `activeTab`: 사용자가 직접 실행한 탭만 다룸
- `scripting`: content script 주입
- `storage`: 캡처 기록과 설정 저장
- `downloads`: 최종 파일 저장

저장소도 역할을 나눴습니다.

| 저장 위치 | 저장 대상 |
| --- | --- |
| `chrome.storage.local` | 캡처 메타데이터, 마지막 캡처 ID |
| `chrome.storage.sync` | 사용자 설정 |
| `IndexedDB` | 실제 이미지 프레임 데이터 |

이 분리를 통해 대형 이미지 데이터와 작은 설정 데이터를 각각 적합한 저장소에 둘 수 있습니다.

</details>

---

## 어려웠던 점과 해결

### 1. MV3 구조에서 캡처 역할을 어디에 둘지 정리하는 문제

가장 먼저 부딪힌 문제는 Chrome MV3의 구조적 제약이었습니다. `service worker`는 DOM을 직접 다룰 수 없고, 반대로 실제 페이지의 스크롤과 선택 오버레이는 `content script`에서만 자연스럽게 처리할 수 있습니다. 여기에 최종 저장용 `captureVisibleTab()` 호출은 다시 백그라운드 쪽 책임이라, 처음부터 역할을 분리하지 않으면 구조가 금방 꼬이기 쉬웠습니다.

이 문제는 **캡처 세션 제어는 `service worker`, 페이지 조작은 `content script`, 후처리는 `editor`**로 명확히 나누는 방식으로 정리했습니다. 덕분에 캡처 로직이 단순 이벤트 호출이 아니라, 단계별 책임이 구분된 작업 파이프라인 형태로 정착됐습니다.

### 2. 긴 페이지를 이어 붙일 때 생기는 오차와 중복 문제

전체 페이지 캡처는 단순히 스크롤을 조금씩 내리며 이미지를 모으는 것으로 끝나지 않았습니다. 실제 스크롤 위치와 계산한 목표 위치 사이에는 브라우저 환경에 따라 미세한 차이가 생기고, 그 상태로 그대로 붙이면 중간이 겹치거나 줄이 어긋나는 문제가 생깁니다.

이를 해결하기 위해:

- 캡처 위치마다 실제 `scrollX`, `scrollY`를 다시 읽고
- tile metadata에 `pageX`, `pageY`, `cropTop`, `cropBottom` 같은 보정 값을 남기고
- 최종 스티칭 단계는 저장된 메타데이터를 기준으로 동작하도록 바꿨습니다.

즉, “예상 위치”가 아니라 “실제 기록된 위치”를 신뢰하는 구조로 바꾼 것이 핵심 개선이었습니다.

### 3. 선택 영역 캡처 UX와 문서 좌표계 처리

선택 영역 캡처는 생각보다 UI 난도가 높았습니다. 사용자가 드래그 도중 페이지 가장자리까지 내려가면 스크롤이 같이 따라가야 하고, 그때도 선택 박스는 끊기지 않고 문서 기준 좌표를 유지해야 합니다.

여기서는 **viewport 좌표와 문서 좌표를 분리해 관리**하고, 자동 스크롤 중에도 선택 rect를 문서 기준으로 계속 재계산하도록 구현했습니다. 그 결과 긴 페이지에서도 드래그를 다시 시작하지 않고 한 번에 영역을 잡을 수 있게 만들었습니다.

### 4. 저장 안정성과 대용량 결과 처리

초기에는 캡처 데이터와 자산을 단순하게 다루는 접근이 편해 보였지만, 긴 페이지로 갈수록 저장 안정성과 후처리 비용이 커졌습니다. 특히 큰 이미지는 메타데이터와 같은 방식으로 다루기보다는 별도 저장 계층으로 분리하는 편이 더 안정적이었습니다.

그래서 최종적으로는:

- **메타데이터는 `chrome.storage.local`**
- **사용자 설정은 `chrome.storage.sync`**
- **이미지 프레임은 IndexedDB**

로 역할을 나눴고, 내보내기 단계에서는 **20MB 이상 결과를 자동으로 분할 저장**하는 옵션까지 추가했습니다.

---

## 배운 점

- 확장 프로그램은 단순 웹앱과 달리 권한, 생명주기, 브라우저 API 제약이 설계에 직접적인 영향을 준다는 점을 배웠습니다.
- 비동기 작업이 여러 단계로 이어질수록 상태를 명시적으로 나누는 것이 디버깅과 유지보수에 훨씬 유리했습니다.
- 사용자가 체감하는 완성도는 “캡처가 된다”보다 “실패가 적고, 결과를 바로 수정하고 저장할 수 있다”에 더 크게 좌우된다는 점을 확인했습니다.
- 실제로는 큰 기능 하나보다 예외 처리, 좌표계 보정, 저장 규칙, 휴리스틱 보정 같은 작은 시스템 설계가 프로젝트 품질을 결정했습니다.
- 도구형 프로젝트에서도 상태 전이, 규칙 기반 결과 처리, 리소스 저장 계층 분리 같은 클라이언트 시스템 설계 감각이 중요하다는 걸 다시 느꼈습니다.

---

## 정량 지표

로컬 개발 환경 기준으로 확인한 수치입니다.

| 항목 | 수치 | 설명 |
| --- | --- | --- |
| **캡처 모드** | 3종 | 현재 화면, 전체 페이지, 선택 영역 |
| **내보내기 포맷** | 2종 | PNG, JPEG |
| **사용자 설정 항목** | 6개 | 저장 확인, 크롭 크기 포함, fixed/sticky 숨김, 파일명 형식, 자동 저장 폴더, 대용량 분할 저장 |
| **기본 단축키** | 4개 | 현재 화면, 전체 페이지, 선택 영역, 팝업 열기 |
| **대용량 분할 기준** | 20MB | 설정 활성화 시 자동 분할 저장 |
| **배포 JS 총 크기** | 약 136.0 KB | `dist/*.js` 합산 기준 |
| **에디터 번들 크기** | 73,166 bytes | `dist/editor.js` |
| **서비스 워커 번들 크기** | 28,064 bytes | `dist/service-worker.js` |
| **콘텐츠 스크립트 번들 크기** | 25,292 bytes | `dist/content-script.js` |
| **설정 화면 번들 크기** | 8,452 bytes | `dist/settings.js` |
| **팝업 번들 크기** | 4,333 bytes | `dist/popup.js` |
| **빌드 시간** | 평균 0.585초 | `npm.cmd run build` 3회 실행 평균, 2026-04-08 로컬 측정 |

정량 수치 외에 구조적으로 개선한 부분도 있습니다.

- 이미지 자산을 IndexedDB로 분리해 큰 캡처 결과를 더 안정적으로 다룰 수 있게 했습니다.
- 저장 규칙과 단축키를 설정 화면으로 분리해 반복 사용 시 진입 비용을 낮췄습니다.
- 크롭 완료 즉시 미리보기에 반영되도록 하여 편집-저장 사이의 확인 단계를 줄였습니다.

---

## 구현 범위

| 영역 | 구현 내용 |
| --- | --- |
| **Popup** | 현재 화면/전체 페이지/선택 영역 캡처 시작, 최근 캡처 에디터 이동, 설정 진입 |
| **Capture Engine** | 스크롤 위치 계산, 자동 스크롤, 타일 프레임 수집, 실패 상태 관리 |
| **Selection UI** | 드래그 선택, 자동 스크롤, 문서 좌표계 보정 |
| **Editor** | 스티칭, 크롭, 미리보기, Undo/Redo, PNG/JPEG 내보내기 |
| **Settings** | 저장 규칙, 파일명 템플릿, 하위 폴더, 대용량 분할 저장, 단축키 안내 |
| **Build/Packaging** | `dist` 산출물 생성, Chrome unpacked extension 로드 가능 형태 유지 |

전체적으로는 도메인 특화 툴이지만, 구현 관점에서는 상태 전이, 비동기 파이프라인, 규칙 기반 결과 처리라는 클라이언트 시스템 문제를 작게 풀어낸 프로젝트입니다.

---

## 프로젝트 구조

```text
ScrollCap/
├── docs/                         # README 스크린샷
│   ├── 1.png
│   └── 2.png
├── scripts/
│   └── build-extension.mjs       # MV3 배포용 dist 빌드
├── src/
│   ├── background/
│   │   └── service-worker.ts     # 캡처 세션 제어
│   ├── content/
│   │   └── content-script.ts     # 페이지 측정, 스크롤, 선택 UI
│   ├── editor/
│   │   ├── main.ts
│   │   ├── runtime.ts            # 스티칭, 크롭, 저장 로직
│   │   └── storage.ts            # 에디터용 자산 로딩 헬퍼
│   ├── popup/
│   │   └── main.ts               # 팝업 동작
│   ├── settings/
│   │   └── main.ts               # 설정 화면 동작
│   └── shared/
│       ├── asset-store.ts
│       ├── capture-types.ts
│       ├── capture-utils.ts
│       ├── constants.ts
│       └── user-settings.ts
├── popup.html / popup.css
├── editor.html / editor.css
├── settings.html / settings.css
├── manifest.json
├── package.json
└── README.md
```

---

## 실행 방법

### 1. 의존성 설치

```bash
npm install
```

### 2. 타입 검사

```bash
npm run typecheck
```

### 3. 확장 프로그램 빌드

```bash
npm run build
```

### 4. Chrome에 로드

```text
chrome://extensions
→ 개발자 모드 ON
→ 압축해제된 확장 프로그램을 로드
→ 이 저장소의 dist 폴더 선택
```

### 5. 개발 중 watch 빌드

```bash
npm run dev
```

Windows PowerShell에서 `npm` 실행이 막히면 아래처럼 `npm.cmd`를 사용하면 됩니다.

```bash
npm.cmd install
npm.cmd run typecheck
npm.cmd run build
```

---

## 권한과 단축키

### 권한

| 권한 | 사용 목적 |
| --- | --- |
| `activeTab` | 사용자가 실행한 현재 탭 캡처 |
| `scripting` | content script 주입 |
| `storage` | 설정/캡처 기록 저장 |
| `downloads` | 내보낸 파일 저장 |

### 기본 단축키

| 동작 | 기본 키 |
| --- | --- |
| 현재 화면 캡처 | `Ctrl+Shift+7` |
| 전체 페이지 캡처 | `Ctrl+Shift+8` |
| 선택 영역 캡처 | `Ctrl+Shift+9` |
| 팝업 열기 | `Ctrl+Shift+0` |

단축키는 `chrome://extensions/shortcuts`에서 변경할 수 있습니다.

---

## 알려진 한계

- 전체 페이지 캡처는 현재 **최상위 세로 스크롤 페이지** 중심으로 동작합니다.
- 중첩 스크롤 컨테이너와 cross-origin iframe은 별도 처리하지 않습니다.
- `fixed/sticky` 요소 숨김은 휴리스틱 기반이라 사이트마다 완벽하지 않을 수 있습니다.
- Chrome 내부 페이지, 확장 페이지 등 일부 제한 페이지는 스크립트 주입이 차단될 수 있습니다.
- 자동 저장 경로는 Chrome 제한상 **다운로드 폴더 하위 경로**만 지정할 수 있습니다.
- 대용량 분할 저장은 최종 blob 크기 기준으로 동작하므로, 이미지 내용에 따라 분할 수는 달라질 수 있습니다.

---

<div align="center">

**ScrollCap** · 2026 · Chrome MV3 캡처 확장 프로젝트

</div>
