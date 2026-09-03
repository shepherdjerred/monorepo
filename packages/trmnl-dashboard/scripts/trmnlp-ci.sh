#!/bin/sh

set -eu

mode=${1:-validate}
plugin_slug=${2:-}
repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
trmnl_root=${TRMNL_ROOT:-"$repo_root/packages/trmnl-dashboard/trmnl"}
fixtures_dir="$trmnl_root/fixtures"
fixture_log="${TMPDIR:-/tmp}/trmnlp-fixtures-$$.log"
fixture_pid=
build_log=
trmnlp_command=${TRMNLP_COMMAND:-trmnlp}

check_plugin_ids() {
  ruby -ryaml -e '
    expected = {
      "home-assistant" => 303046,
      "homelab" => 303047,
      "pets" => 464652,
    }
    settings = expected.to_h do |slug, _expected_id|
      path = File.join(ARGV.fetch(0), slug, "src", "settings.yml")
      [slug, YAML.safe_load_file(path)]
    end
    ids = settings.map do |slug, values|
      id = values["id"]
      abort "#{slug}: missing committed plugin id" if id.nil?
      id
    end
    abort "duplicate committed plugin ids: #{ids.join(", ")}" unless ids.uniq.length == ids.length
    settings.each do |slug, values|
      id = values.fetch("id")
      expected_id = expected.fetch(slug)
      abort "#{slug}: expected plugin id #{expected_id}, found #{id}" unless id == expected_id
    end
  ' "$trmnl_root"
}

cleanup() {
  if [ -n "$fixture_pid" ] && ps -p "$fixture_pid" >/dev/null; then
    kill "$fixture_pid"
  fi
  if [ -n "$build_log" ] && [ -f "$build_log" ]; then
    rm -f "$build_log"
  fi
}

start_fixture_server() {
  ruby -rsocket -e '
    root = ARGV.fetch(0)
    server = TCPServer.new("127.0.0.1", 4568)
    loop do
      socket = server.accept
      request = socket.gets
      path = request.to_s.split.fetch(1, "")
      while (line = socket.gets)
        break if line == "\r\n"
      end
      file = File.join(root, File.basename(path))
      if File.file?(file)
        body = File.binread(file)
        socket.write "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: #{body.bytesize}\r\nConnection: close\r\n\r\n#{body}"
      else
        socket.write "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
      end
      socket.close
    end
  ' "$fixtures_dir" >"$fixture_log" 2>&1 &
  fixture_pid=$!
  trap cleanup EXIT HUP INT TERM

  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if ruby -rsocket -e '
      begin
        paths = %w[home-assistant.json homelab.json pets.json]
        ready = paths.all? do |path|
          socket = TCPSocket.new("127.0.0.1", 4568)
          socket.write "GET /#{path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
          response = socket.read
          socket.close
          response.start_with?("HTTP/1.1 200")
        end
        exit(ready ? 0 : 1)
      rescue SystemCallError
        exit 1
      end
    ' ; then
      return
    fi
    if ! ps -p "$fixture_pid" >/dev/null; then
      cat "$fixture_log"
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  cat "$fixture_log"
  echo "fixture server did not become ready" >&2
  exit 1
}

validate_project() {
  project="$1"
  if [ -d "$project/_build" ]; then
    find "$project/_build" -type f -delete
  fi

  "$trmnlp_command" lint --dir "$project"
  build_project "$project"

  for view in full half_horizontal half_vertical quadrant; do
    test -s "$project/_build/$view.html"
    test -s "$project/_build/$view.png"
  done
}

build_project() {
  project="$1"
  build_log=$(mktemp)
  if "$trmnlp_command" build --png --dir "$project" >"$build_log" 2>&1; then
    cat "$build_log"
    rm -f "$build_log"
    build_log=
    return
  fi

  cat "$build_log"
  if ! grep -Fq 'Selenium::WebDriver::Error::TimeoutError' "$build_log"; then
    rm -f "$build_log"
    build_log=
    return 1
  fi

  echo "trmnlp screenshot timed out; retrying this project once" >&2
  rm -f "$build_log"
  build_log=
  find "$project/_build" -type f -delete
  "$trmnlp_command" build --png --dir "$project"
}

validate_all() {
  start_fixture_server
  validate_project "$trmnl_root/home-assistant"
  validate_project "$trmnl_root/homelab"
  validate_project "$trmnl_root/pets"
}

self_test() {
  self_test_dir=$(mktemp -d)
  mkdir -p "$self_test_dir/trmnl"
  cp -R "$trmnl_root/fixtures" "$self_test_dir/trmnl/fixtures"
  cp -R "$trmnl_root/home-assistant" "$self_test_dir/trmnl/home-assistant"
  cp -R "$trmnl_root/homelab" "$self_test_dir/trmnl/homelab"
  cp -R "$trmnl_root/pets" "$self_test_dir/trmnl/pets"

  ruby -ryaml -e '
    path = ARGV.fetch(0)
    settings = YAML.safe_load_file(path)
    settings.delete("id")
    File.write(path, settings.to_yaml)
  ' "$self_test_dir/trmnl/home-assistant/src/settings.yml"
  if TRMNL_ROOT="$self_test_dir/trmnl" "$0" check-ids; then
    echo "missing plugin id was accepted" >&2
    exit 1
  fi

  cp "$trmnl_root/home-assistant/src/settings.yml" "$self_test_dir/trmnl/home-assistant/src/settings.yml"
  ruby -ryaml -e '
    path = ARGV.fetch(0)
    settings = YAML.safe_load_file(path)
    settings["id"] = 303046
    File.write(path, settings.to_yaml)
  ' "$self_test_dir/trmnl/homelab/src/settings.yml"
  if TRMNL_ROOT="$self_test_dir/trmnl" "$0" check-ids; then
    echo "duplicate plugin ids were accepted" >&2
    exit 1
  fi

  cp "$trmnl_root/homelab/src/settings.yml" "$self_test_dir/trmnl/homelab/src/settings.yml"
  fake_trmnlp="$self_test_dir/fake-trmnlp"
  publish_log="$self_test_dir/push.log"
  cat >"$fake_trmnlp" <<'SCRIPT'
#!/bin/sh
set -eu
command=$1
shift
project=
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--dir" ]; then
    project=$2
    shift 2
  else
    shift
  fi
done
case "$command" in
  lint)
    if [ "${TRMNLP_TEST_FAIL_HOMELAB:-}" = "1" ] && [ "$(basename "$project")" = "homelab" ]; then
      exit 42
    fi
    ;;
  build)
    if [ -n "${TRMNLP_TEST_RETRY_LOG:-}" ] && [ "$(basename "$project")" = "home-assistant" ]; then
      attempts=0
      if [ -f "$TRMNLP_TEST_RETRY_LOG" ]; then
        attempts=$(wc -l <"$TRMNLP_TEST_RETRY_LOG")
      fi
      printf 'attempt\n' >>"$TRMNLP_TEST_RETRY_LOG"
      if [ "$attempts" -eq 0 ]; then
        echo 'Selenium::WebDriver::Error::TimeoutError' >&2
        exit 1
      fi
    fi
    mkdir -p "$project/_build"
    for view in full half_horizontal half_vertical quadrant; do
      printf 'fixture\n' >"$project/_build/$view.html"
      printf 'fixture\n' >"$project/_build/$view.png"
    done
    ;;
  push)
    echo "$project" >>"$TRMNLP_TEST_LOG"
    ;;
esac
SCRIPT
  chmod +x "$fake_trmnlp"
  if TRMNL_ROOT="$self_test_dir/trmnl" \
    TRMNLP_COMMAND="$fake_trmnlp" \
    TRMNLP_TEST_LOG="$publish_log" \
    TRMNLP_TEST_FAIL_HOMELAB=1 \
    TRMNL_API_KEY=self-test \
    "$0" publish; then
    echo "publication continued after a plugin validation failure" >&2
    exit 1
  fi
  if [ -s "$publish_log" ]; then
    echo "a plugin was published before all validation completed" >&2
    exit 1
  fi

  retry_log="$self_test_dir/retry.log"
  TRMNL_ROOT="$self_test_dir/trmnl" \
    TRMNLP_COMMAND="$fake_trmnlp" \
    TRMNLP_TEST_RETRY_LOG="$retry_log" \
    "$0" validate
  if [ "$(wc -l <"$retry_log")" -ne 2 ]; then
    echo "the Selenium timeout did not trigger exactly one retry" >&2
    exit 1
  fi

  : >"$publish_log"
  TRMNL_ROOT="$self_test_dir/trmnl" \
    TRMNLP_COMMAND="$fake_trmnlp" \
    TRMNLP_TEST_LOG="$publish_log" \
    TRMNL_API_KEY=self-test \
    "$0" publish
  expected_publish_log="$self_test_dir/expected-push.log"
  printf '%s\n' \
    "$self_test_dir/trmnl/home-assistant" \
    "$self_test_dir/trmnl/homelab" \
    "$self_test_dir/trmnl/pets" >"$expected_publish_log"
  if ! cmp -s "$expected_publish_log" "$publish_log"; then
    echo "plugins were not published exactly once in deterministic order" >&2
    diff -u "$expected_publish_log" "$publish_log"
    exit 1
  fi
}

check_plugin_ids

case "$mode" in
  check-ids)
    ;;
  self-test)
    self_test
    ;;
  validate)
    validate_all
    ;;
  publish)
    if [ -z "${TRMNL_API_KEY:-}" ]; then
      echo "TRMNL_API_KEY is required for publication" >&2
      exit 1
    fi
    validate_all
    "$trmnlp_command" push --force --dir "$trmnl_root/home-assistant"
    "$trmnlp_command" push --force --dir "$trmnl_root/homelab"
    "$trmnlp_command" push --force --dir "$trmnl_root/pets"
    git -C "$repo_root" diff --exit-code -- \
      packages/trmnl-dashboard/trmnl/home-assistant \
      packages/trmnl-dashboard/trmnl/homelab \
      packages/trmnl-dashboard/trmnl/pets
    ;;
  serve)
    case "$plugin_slug" in
      home-assistant | homelab | pets)
        ;;
      *)
        echo "serve requires home-assistant, homelab, or pets" >&2
        exit 1
        ;;
    esac
    start_fixture_server
    "$trmnlp_command" serve --bind 0.0.0.0 --dir "$trmnl_root/$plugin_slug"
    ;;
  *)
    echo "usage: $0 {check-ids|self-test|validate|publish|serve <home-assistant|homelab|pets>}" >&2
    exit 1
    ;;
esac
