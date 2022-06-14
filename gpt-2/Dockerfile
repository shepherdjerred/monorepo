FROM tensorflow/tensorflow:1.15.2-py3

ENV LANG=C.UTF-8

RUN mkdir /opt/program/
WORKDIR /opt/program/

COPY requirements.txt /opt/program
RUN pip3 install -r requirements.txt

COPY download_model.py /opt/program
RUN python3 download_model.py 124M
RUN python3 download_model.py 355M
RUN python3 download_model.py 774M
RUN python3 download_model.py 1558M

COPY . /opt/program

ENV PYTHONPATH="/opt/program/src/"
ENV PATH="/opt/program/:${PATH}"

ENV PYTHONUNBUFFERED=TRUE
ENV PYTHONDONTWRITEBYTECODE=TRUE
