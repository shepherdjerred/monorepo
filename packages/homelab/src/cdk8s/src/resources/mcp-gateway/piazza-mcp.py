from fastmcp import FastMCP
from piazza_api import Piazza
from piazza_api.rpc import PiazzaRPC
import json
import os

mcp = FastMCP("piazza")

piazza = Piazza()

# Cookie-based auth bypasses SSO/2FA (e.g. Georgia Tech Duo)
COOKIES = os.getenv("PIAZZA_COOKIES", "")

# Fallback to email/password if no cookies
EMAIL = os.getenv("PIAZZA_EMAIL", "")
PASSWORD = os.getenv("PIAZZA_PASSWORD", "")

# Get courses from environment variable (JSON object mapping id -> name)
def parse_courses_env() -> dict:
    courses_env = os.getenv("PIAZZA_COURSES", "")
    if not courses_env:
        return {}
    try:
        courses = json.loads(courses_env)
        if isinstance(courses, dict):
            return courses
    except json.JSONDecodeError:
        pass
    return {}

COURSES = parse_courses_env()


def ensure_authenticated():
    """Authenticate using cookies (preferred) or email/password fallback."""
    global piazza
    if COOKIES:
        try:
            cookie_dict = json.loads(COOKIES)
            rpc = PiazzaRPC()
            rpc.set_cookies(cookie_dict)
            piazza._rpc_api = rpc
            print("Authenticated with cookies")
            return True
        except (json.JSONDecodeError, Exception) as e:
            print(f"Cookie authentication failed: {str(e)}")
            return False
    elif EMAIL and PASSWORD:
        try:
            piazza.user_login(email=EMAIL, password=PASSWORD)
            print(f"Authenticated with email: {EMAIL}")
            return True
        except Exception as e:
            print(f"Authentication failed: {str(e)}")
            return False
    return False


def get_courses() -> dict:
    """Return courses configured via PIAZZA_COURSES environment variable."""
    return COURSES.copy()


@mcp.tool
def fetch_posts(course_id: str, n: int = 10):
    """Fetch recent posts from a Piazza course given its course ID and number of posts."""
    def fetch_with_retry(retry_count=0):
        try:
            course = piazza.network(course_id)
            posts = course.iter_all_posts(limit=n)
            posts_list = []

            for post in posts:
                filtered_post = {
                    "id": post.get("nr"),
                    "subject": post.get("history", [{}])[0].get("subject") if post.get("history") else None,
                    "content": post.get("history", [{}])[0].get("content") if post.get("history") else None,
                    "created": post.get("created"),
                    "replies": []
                }

                # replies from children
                if post.get("children"):
                    for child in post.get("children"):
                        reply = {
                            "id": child.get("id"),
                            "subject": child.get("subject") or child.get("history", [{}])[0].get("subject") if child.get("history") else None,
                            "content": child.get("subject") or child.get("history", [{}])[0].get("content") if child.get("history") else None,
                            "created": child.get("created"),
                            "type": child.get("type")
                        }
                        filtered_post["replies"].append(reply)

                posts_list.append(filtered_post)

            return {"status": "success", "posts": posts_list}

        except json.JSONDecodeError as e:
            if retry_count == 0:
                print(f"JSON decode error, attempting to re-authenticate: {str(e)}")
                if ensure_authenticated():
                    return fetch_with_retry(retry_count + 1)
            print(f"Authentication failed after retry")
            raise RuntimeError(
                "Session expired. Please check your Piazza credentials and restart the server."
            )
        except Exception as e:
            print(f"Error fetching posts: {str(e)}")
            raise RuntimeError(f"Failed to fetch posts: {str(e)}")

    return fetch_with_retry()


@mcp.tool
def list_courses():
    """Return courses configured via PIAZZA_COURSES environment variable. Returns a mapping of course ID to course name."""
    courses = get_courses()
    return {
        "status": "success",
        "courses": [{"id": id, "name": name} for id, name in courses.items()]
    }


if __name__ == '__main__':
    ensure_authenticated()
    mcp.run()
