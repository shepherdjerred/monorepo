# Python release lifecycle

Read this when selecting a Python version, adopting a 3.14 feature, or evaluating a 3.15 prerelease capability.

## Status

Python 3.14.6 was current stable on 2026-08-03, with 3.14.7 scheduled for the following day. Record the verification date with patch claims. Python 3.15 remained beta, with final release scheduled for 2026-10-01.

Python 3.14 includes deferred annotations, template strings, subinterpreters, Zstandard compression, external debugger attachment, and officially supported free threading. Each feature has distinct security and compatibility boundaries described in the other references.

Python 3.15 prerelease documentation includes lazy imports, `frozendict`, sentinels, comprehension unpacking, UTF-8 default encoding, `TypeForm`, and a free-threaded stable ABI. Treat beta behavior as changeable until final.

## Research ledger

The following 48 authoritative pages were fetched and inspected:

1. [Python downloads](https://www.python.org/downloads/)
2. [Python version status](https://devguide.python.org/versions/)
3. [What's New in Python 3.14](https://docs.python.org/3/whatsnew/3.14.html)
4. [What's New in Python 3.15](https://docs.python.org/3.15/whatsnew/3.15.html)
5. [Python 3.14 schedule](https://peps.python.org/pep-0745/)
6. [Python 3.15 schedule](https://peps.python.org/pep-0790/)
7. [annotationlib](https://docs.python.org/3/library/annotationlib.html)
8. [string.templatelib](https://docs.python.org/3/library/string.templatelib.html)
9. [concurrent.interpreters](https://docs.python.org/3/library/concurrent.interpreters.html)
10. [Free-threading HOWTO](https://docs.python.org/3/howto/free-threading-python.html)
11. [compression.zstd](https://docs.python.org/3/library/compression.zstd.html)
12. [pdb](https://docs.python.org/3/library/pdb.html)
13. [pathlib](https://docs.python.org/3/library/pathlib.html)
14. [asyncio tasks](https://docs.python.org/3/library/asyncio-task.html)
15. [typing](https://docs.python.org/3/library/typing.html)
16. [venv](https://docs.python.org/3/library/venv.html)
17. [Packaging Python projects](https://packaging.python.org/en/latest/tutorials/packaging-projects/)
18. [Writing pyproject.toml](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/)
19. [pip install](https://pip.pypa.io/en/stable/cli/pip_install/)
20. [pip lock](https://pip.pypa.io/en/stable/cli/pip_lock/)
21. [Secure pip installs](https://pip.pypa.io/en/stable/topics/secure-installs/)
22. [uv projects](https://docs.astral.sh/uv/guides/projects/)
23. [uv project layout](https://docs.astral.sh/uv/concepts/projects/layout/)
24. [uv locking and syncing](https://docs.astral.sh/uv/concepts/projects/sync/)
25. [uv project configuration](https://docs.astral.sh/uv/concepts/projects/config/)
26. [uv workspaces](https://docs.astral.sh/uv/concepts/projects/workspaces/)
27. [uv packaging](https://docs.astral.sh/uv/guides/package/)
28. [uv publishing](https://docs.astral.sh/uv/guides/publish/)
29. [uv pip interface](https://docs.astral.sh/uv/pip/)
30. [uv CLI](https://docs.astral.sh/uv/reference/cli/)
31. [pytest fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html)
32. [pytest parametrization](https://docs.pytest.org/en/stable/how-to/parametrize.html)
33. [pytest integration practices](https://docs.pytest.org/en/stable/explanation/goodpractices.html)
34. [pytest changelog](https://docs.pytest.org/en/stable/changelog.html)
35. [Ruff configuration](https://docs.astral.sh/ruff/configuration/)
36. [Ruff formatter](https://docs.astral.sh/ruff/formatter/)
37. [Ruff linter](https://docs.astral.sh/ruff/linter/)
38. [Ruff versioning](https://docs.astral.sh/ruff/versioning/)
39. [Mypy release notes](https://mypy.readthedocs.io/en/stable/changelog.html)
40. [Pyright configuration](https://microsoft.github.io/pyright/#/configuration)
41. [pytest-asyncio concepts](https://pytest-asyncio.readthedocs.io/en/stable/concepts.html)
42. [pytest-xdist distribution](https://pytest-xdist.readthedocs.io/en/stable/distribution.html)
43. [pytest-cov configuration](https://pytest-cov.readthedocs.io/en/latest/config.html)
44. [pip-audit](https://pypi.org/project/pip-audit/)
45. [subprocess](https://docs.python.org/3/library/subprocess.html)
46. [secrets](https://docs.python.org/3/library/secrets.html)
47. [pickle](https://docs.python.org/3/library/pickle.html)
48. [tarfile](https://docs.python.org/3/library/tarfile.html)

The archived [nest_asyncio repository](https://github.com/erdewit/nest_asyncio) was also inspected to verify that it should be removed from recommendations.
