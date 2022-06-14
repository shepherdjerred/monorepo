<template>
    <div>
        <div class="column is-one-third-desktop is-offset-one-third-desktop">
            <div class="tabs is-fullwidth">
                <ul>
                    <li>
                        <router-link :to="{ name: 'Login' }">
                            <span class="icon">
                                <i class="fa fa-user"></i>
                            </span>
                            <span>Login</span>
                        </router-link>
                    </li>
                    <li>
                        <router-link :to="{ name: 'Register' }">
                            <span class="icon">
                                <i class="fa fa-check"></i>
                            </span>
                            <span>Register</span>
                        </router-link>
                    </li>
                </ul>
            </div>
            <h1 class="title">Register</h1>
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
                    <template v-if="password.length < 8 && password.length > 0">
                        <p class="help">
                            <span class="tag is-warning">Your password must be at least 8 characters long</span>
                        </p>
                    </template>
                    <p class="help">
                        <a href="https://lastpass.com/generatepassword.php">Password generator</a>
                    </p>
                </div>
                <div class="field">
                    <label class="label">
                        Confirm Password
                        <span class="control">
                             <input type="password"
                                    class="input"
                                    required
                                    v-model="confirmPassword">
                        </span>
                    </label>
                    <template v-if="password !== confirmPassword && confirmPassword.length > 0">
                        <span class="tag is-danger">Your password doesn't match!</span>
                    </template>
                </div>
                <div class="field">
                    <label class="label">
                        Referrer
                        <span class="control">
                        <input class="input"
                               required
                               v-model="referrer"
                               placeholder="d04a6c25-2810-43e4-b9d7-13c157458bfa">
                    </span>
                    </label>
                    <p class="help">
                        You need the UUID of another user to create a new account
                    </p>
                </div>
                <button class="button is-primary">Create Account</button>
            </form>
        </div>
    </div>
</template>

<script>
  export default {
    name: 'User-Register',
    data: function () {
      return {
        username: '',
        password: '',
        confirmPassword: '',
        referrer: ''
      };
    },
    methods: {
      onSubmit: function () {
        if (this.password !== this.confirmPassword) {
          return;
        }
        this.$http.post('/api/user/register', {
          'username': this.username,
          'password': this.password,
          'referrer': this.referrer
        }).then(response => {
          console.log(response.body);
          localStorage.setItem('jwt', response.body.jsonWebToken);
          this.$store.dispatch('updateUser');
          this.$router.push({name: 'Home'});
        }, response => {
          console.log(response.body);
        });
      }
    }
  };
</script>
