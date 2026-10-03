<?php
// Credentials are runtime mounts, never literals in the licensed source tree.
$config['db']['host'] = 'db';
$config['db']['username'] = 'forum';
$config['db']['password'] = trim(file_get_contents('/run/secrets/db_password'));
$config['db']['dbname'] = 'forum';
$config['fullUnicode'] = true;
$config['enableMail'] = false;
$config['enableMailQueue'] = false;
$config['enableApi'] = true;
$config['superAdmins'] = '1';
