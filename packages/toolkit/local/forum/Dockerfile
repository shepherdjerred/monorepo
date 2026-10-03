FROM php:8.3-apache@sha256:c2c73159da2f7a19167a2849bd9785ca9ad4f5eeff01f85295ef861a5e9bcf4d
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpng-dev=1.6.48-1+deb13u6 \
        libjpeg62-turbo-dev=1:2.1.5-4 \
        libfreetype-dev=2.13.3+dfsg-1+deb13u1 \
        libonig-dev=6.9.9-1+b1 \
        libxml2-dev=2.12.7+dfsg+really2.9.14-2.1+deb13u3 \
        libcurl4-openssl-dev=8.14.1-2+deb13u5 \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install mysqli gd mbstring dom simplexml curl \
    && a2enmod rewrite \
    && rm -rf /var/lib/apt/lists/*
COPY apache.conf /etc/apache2/conf-enabled/forum.conf
COPY setup.php /opt/forum/setup.php
COPY session.php /opt/forum/session.php
COPY profile.php identity-words.json /opt/forum/
WORKDIR /var/www/html
