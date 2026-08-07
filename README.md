# GPT Business 운영대장

여러 ChatGPT Business 워크스페이스의 좌석, 상시 멤버, 기간제 멤버, 강의 일정을 관리하는 정적 웹앱입니다. 실제 ChatGPT 로그인·초대·삭제는 수행하지 않으며 운영 상태만 기록합니다.

## GitHub Pages 배포

1. 이 폴더의 전체 파일을 GitHub 저장소 `main` 브랜치에 올립니다.
2. 저장소 **Settings → Pages → Build and deployment → Source**를 `GitHub Actions`로 선택합니다.
3. `main` 브랜치에 push하면 `.github/workflows/deploy-pages.yml`이 사이트를 자동 배포합니다.

별도의 `npm install`이나 빌드 명령은 필요 없습니다. `index.html`을 직접 열어도 로컬 데모로 동작합니다.

## Google Sheets 연결

1. 빈 Google Spreadsheet를 만들고 **확장 프로그램 → Apps Script**를 엽니다.
2. `apps-script/Code.gs`의 내용을 붙여 넣습니다.
3. Apps Script 편집기에서 `setup` 함수를 한 번 실행하고 권한을 승인합니다.
4. **배포 → 새 배포 → 웹 앱**을 선택합니다.
5. 실행 사용자는 본인, 접근 권한은 운영 환경에 맞게 선택한 뒤 배포합니다.
6. 생성된 `/exec` URL을 웹앱의 **연결 설정** 화면에 입력합니다.

연결 전에는 브라우저 `localStorage`에만 저장됩니다. 연결 후에도 네트워크 오류에 대비해 마지막 데이터가 브라우저에 남습니다.

## 데이터 시트

`setup()` 실행 시 다음 시트가 생성됩니다.

- `roots`: 워크스페이스 소유 계정, 결제일, 만료일, 좌석 수
- `children`: 워크스페이스의 상시 멤버
- `guests`: 임시 초대 기간제 멤버와 제거 처리일
- `courses`: 강의 일정, 필요 좌석, 배정 좌석
- `settings`: 소유자 좌석 포함 여부

## 보안 참고

정적 GitHub Pages에는 서버 비밀값을 안전하게 숨길 수 없습니다. `config.js`에 비밀키, 비밀번호, 개인 데이터 또는 서비스 계정 키를 넣지 마세요. Apps Script를 “모든 사용자”에게 공개하면 URL을 아는 사람이 데이터를 읽거나 쓸 수 있으므로, 실제 운영에서는 조직 접근 정책을 적용하거나 별도의 인증 프록시를 두는 편이 안전합니다.
