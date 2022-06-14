const state = {
  activeTheme: {
    display: 'Classic',
    icon: '',
    iconColor: '',
    primaryColor: '#e84545',
    userNounSingular: 'user',
    userNounPlural: 'users',
    reward: {
      display: 'Puppy',
      type: 'image',
      url: 'http://theprojectheal.org/wp-content/uploads/2016/01/Aaaaaawwwwwwwwww-Sweet-puppies-9415255-1600-1200.jpg'
    }
  },
  presetThemes: {
    classic: {
      display: 'Classic',
      icon: '',
      iconColor: '',
      primaryColor: '#e84545',
      userNounSingular: 'user',
      userNounPlural: 'users',
      reward: {
        display: 'Puppy',
        type: 'image',
        url: 'http://theprojectheal.org/wp-content/uploads/2016/01/Aaaaaawwwwwwwwww-Sweet-puppies-9415255-1600-1200.jpg'
      }
    },
    sigphi: {
      display: 'Sigma Phi Mu',
      icon: 'fa-anchor',
      iconColor: '#fff',
      primaryColor: '#47D2E9',
      userNounSingular: 'anchor',
      userNounPlural: 'anchors',
      reward: {
        display: 'Sigma Phi Mu Letters',
        type: 'image',
        url: 'https://scontent-dft4-3.xx.fbcdn.net/v/t1.0-9/22552458_10214767474565309_5973073763311704070_n.jpg?oh=54d36bcfd76372e6d811fbe680adadf1&oe=5B1B4E52'
      }
    },
    amazon: {
      display: 'Amazon',
      icon: 'fa-amazon',
      iconColor: '#fff',
      primaryColor: '#ff9900',
      userNounSingular: 'Amazonian',
      userNounPlural: 'Amazonians',
      reward: {
        display: 'Amazon Spheres',
        type: 'image',
        url: 'https://archpaper.com/wp-content/uploads/2018/01/Amazon-spheres-NBBJ-hero-construction.jpg'
      }
    }
  }
};

const mutations = {
  setIcon (state, value) {
    state.activeTheme.icon = value;
  },
  setIconColor (state, value) {
    state.activeTheme.iconColor = value;
  },
  setPrimaryColor (state, value) {
    state.activeTheme.primaryColor = value;
  },
  usePresetTheme (state, value) {
    state.activeTheme = state.presetThemes[value];
  }
};

const actions = {
};

export default {
  state,
  mutations,
  actions
};
