FROM php:8.3-apache@sha256:c2c73159da2f7a19167a2849bd9785ca9ad4f5eeff01f85295ef861a5e9bcf4d
RUN apt-get update && apt-get install -y --no-install-recommends libpng-dev libjpeg62-turbo-dev libfreetype6-dev libonig-dev libxml2-dev libcurl4-openssl-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install mysqli gd mbstring dom simplexml curl \
    && a2enmod rewrite \
    && rm -rf /var/lib/apt/lists/*
COPY apache.conf /etc/apache2/conf-enabled/forum.conf
COPY setup.php /opt/forum/setup.php
COPY session.php /opt/forum/session.php
WORKDIR /var/www/html
