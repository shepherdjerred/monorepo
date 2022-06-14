<template>
  <div>
    <div class="container">
      <div class="columns">
        <div class="column is-one-third is-offset-one-third">
          <div class="box loginMenu">
            <h3 class="title is-3">Login to Easely</h3>

            <template v-if="loginError">
              <div class="notification is-danger">
                Invalid username or password
              </div>
            </template>
            <form v-on:submit.prevent="onSubmit">
              <div class="field">
                <label class="label" for="email">Email address</label>
                <div class="control">
                  <input class="input" type="email" id="email" v-model="email" required>
                </div>
              </div>

              <div class="field">
                <label class="label" for="password">Password</label>
                <div class="control">
                  <input class="input" type="password" id="password" v-model="password" required>
                </div>
              </div>

              <button type="submit" class="button is-primary">Login</button>
              <button type="button" class="button is-light">Forgot password?</button>
            </form>

            <router-link :to="{ name: 'Register' }">
              Don't have an account? Register now
            </router-link>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<script>
  export default {
    name: 'User-Login',
    data: function () {
      return {
        email: '',
        password: '',
        loginError: false
      };
    },
    methods: {
      onSubmit: function () {
        this.$http.post(process.env.API_URL + '/api/user/login', {
          'email': this.email,
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

<style lang="scss" scoped>
  .loginMenu {
    margin-top: 30px;
  }
</style>
