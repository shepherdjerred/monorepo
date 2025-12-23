<template>
    <div>
        <div class="column is-one-third-desktop is-offset-one-third-desktop">
            <div class="tabs is-fullwidth">
                <ul>
                    <li>
                        <router-link :to="{ name: 'Login' }">
                            <span class="icon"><i class="fa fa-user"></i></span>
                            <span>Login</span>
                        </router-link>
                    </li>
                    <li>
                        <router-link :to="{ name: 'Register' }">
                            <span class="icon"><i class="fa fa-check"></i></span>
                            <span>Register</span>
                        </router-link>
                    </li>
                </ul>
            </div>
            <h1 class="title">Login</h1>
            <template v-if="loginError">
                <div class="notification is-danger">
                    Incorrect username or password
                </div>
            </template>
            <form v-on:submit.prevent="onSubmit">
                <div class="field">
                    <label class="label">
                        Username
                        <span class="control">
                        <input name="username"
                               class="input"
                               required
                               v-model="username">
                    </span>
                    </label>
                </div>
                <div class="field">
                    <label class="label">
                        Password
                        <span class="control">
                        <input type="password"
                               name="password"
                               class="input"
                               required
                               v-model="password">
                    </span>
                    </label>
                </div>
                <button class="button is-primary">Login</button>
            </form>
        </div>
    </div>
</template>

<script>
  export default {
    name: 'User-Login',
    data: function () {
      return {
        username: '',
        password: '',
        loginError: false
      };
    },
    methods: {
      onSubmit: function () {
        this.$http.post('/api/user/login', {
          'username': this.username,
          'password': this.password
        }).then(response => {
          console.log(response.body);
          localStorage.setItem('jwt', response.body.jsonWebToken);
          this.$store.dispatch('updateUser');
          this.$router.push({name: 'Home'});
        }, response => {
          console.log(response.body);
          this.loginError = true;
        });
      }
    }
  };
</script>
