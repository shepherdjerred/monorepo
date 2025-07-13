import requests
import re
from bs4 import BeautifulSoup


BASE_URL ="https://frankieandjos.com"
LAST_NEWS_PAGE = 10


class Flavor:
  def __init__(self, name, description):
    self.name = name
    self.description = description
  
  
  def __repr__(self):
    return f"""
    name: {self.name},
    description {self.description}
    """


def get_flavor_pages(page_number):
  page = requests.get(BASE_URL + f"/blogs/news?page={page_number}")
  content = page.text
  current_page_flavors = re.findall("(\/blogs\/news\/[a-zA-Z0-9-]+flavor[s]*[a-zA-Z0-9-]+)", content, re.DOTALL)
  print(f"Found URLs: {current_page_flavors}")
  return current_page_flavors
  

def get_all_flavor_pages():
  pages = []
  for page_number in range(1, LAST_NEWS_PAGE + 1):
    pages.extend(get_flavor_pages(page_number))
  return pages

# BeautifulSoup Grab Visible Webpage Text
# https://stackoverflow.com/questions/1936466/beautifulsoup-grab-visible-webpage-text
def get_flavors_text_from_page(url):
  page = requests.get(BASE_URL + url)
  soup = BeautifulSoup(page.text, 'html.parser')
  article_content = soup.find("div", {"class": "article__content"})
  visible_text = article_content.getText()
  return visible_text


def get_flavors_from_page(url):
  flavors = []
  flavors_text = get_flavors_text_from_page(url)
  return flavors_text

  for entry in flavors_text:
    name = entry[0]
    description = entry[1]
    flavor = Flavor(name, description)
    flavors.append(flavor)
  
  return flavors

def main():
  pages = get_all_flavor_pages()
  flavors = []
  for page in pages:
    page_flavors = get_flavors_from_page(page)
    print(page_flavors)
    continue
    flavors.extend()


if __name__ == "__main__":
  main()
