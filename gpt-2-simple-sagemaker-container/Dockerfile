FROM intelaipg/intel-optimized-tensorflow:1.15.2-py3

# Use TensorFlow with AVX and other optimizations
# RUN pip3 --no-cache-dir install https://github.com/mind/wheels/releases/download/tf1.5-cpu/tensorflow-1.5.0-cp36-cp36m-linux_x86_64.whli

ENV LANG=C.UTF-8

RUN mkdir /opt/program/
WORKDIR /opt/program/

COPY requirements.txt /opt/program
RUN pip3 install -r requirements.txt

COPY . /opt/program

ENV PYTHONPATH="/opt/program/src/"
ENV PATH="/opt/program/:${PATH}"

ENV PYTHONUNBUFFERED=TRUE
ENV PYTHONDONTWRITEBYTECODE=TRUE

EXPOSE 8080
