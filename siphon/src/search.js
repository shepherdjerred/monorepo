export default {
  options: {
    shouldSort: true,
    threshold: 0.3,
    location: 0,
    distance: 100,
    maxPatternLength: 32,
    minMatchCharLength: 1,
    keys: [
      {
        name: 'name',
        weight: 0.6
      },
      {
        name: 'link',
        weight: 0.1
      },
      {
        name: 'terms',
        weight: 0.3
      }
    ]
  },
  links: [
    {
      name: 'Financial info',
      link: 'https://ssb.pipeline.harding.edu/embed/z_cashnet_sso.p_cashnet_login',
      type: 'EXTERNAL',
      terms: [
        'Account',
        'Balance',
        'CASHNet'
      ]
    },
    {
      name: 'Financial aid',
      link: 'https://ssb.pipeline.harding.edu/hrdg/twbkwbis.P_GenMenu?name=bmenu.P_FinAidMainMnu',
      type: 'EXTERNAL'
    },
    {
      name: 'Dorm information',
      link: 'https://pipeline.harding.edu/block/66',
      type: 'EXTERNAL',
      terms: [
        'Sign out',
        'Housing'
      ]
    },
    {
      name: 'Privileged housing status',
      link: 'https://ssb.pipeline.harding.edu/hrdg/zwskphap.P_StuEntry',
      type: 'EXTERNAL',
      terms: [
        'Dorm'
      ]
    },
    {
      name: 'Important dates',
      link: 'https://pipeline.harding.edu/block/50',
      type: 'EXTERNAL',
      terms: [
        'Finals',
        'Schedule'
      ]
    },
    {
      name: 'Microsoft office for students',
      link: 'https://pipeline.harding.edu/block/39',
      type: 'EXTERNAL',
      terms: [
        'Word',
        'PowerPoint',
        'Excel'
      ]
    },
    {
      name: 'Campus box',
      link: 'https://ssb.pipeline.harding.edu/hrdg/zwlkcomb.P_DispInfo',
      type: 'EXTERNAL',
      terms: [
        'Mail',
        'Post office'
      ]
    },
    {
      name: 'Chapel information',
      link: 'https://pipeline.harding.edu/block/592',
      type: 'EXTERNAL'
    },
    {
      name: 'Schedule planner',
      link: 'https://ssb.pipeline.harding.edu/embed/csched.p_redirect',
      type: 'EXTERNAL'
    },
    {
      name: 'Schedule viewer by week',
      link: 'https://ssb.pipeline.harding.edu/hrdg/bwskfshd.P_CrseSchd',
      type: 'EXTERNAL'
    },
    {
      name: 'Enrolled classes',
      link: 'https://ssb.pipeline.harding.edu/hrdg/bwskfshd.P_CrseSchdDetl',
      type: 'EXTERNAL'
    },
    {
      name: 'Schedule planner cart',
      link: 'https://ssb.pipeline.harding.edu/hrdg/csched.p_regs_ssb',
      type: 'EXTERNAL'
    },
    {
      name: 'Chapel seat selection',
      link: 'https://ssb.pipeline.harding.edu/hrdg/szpseat.P_PickSeat',
      type: 'EXTERNAL'
    },
    {
      name: 'Purchase textbooks',
      link: 'https://pipeline.harding.edu/block/386',
      type: 'EXTERNAL',
      terms: [
        'Bookstore'
      ]
    },
    {
      name: 'Testing Lab',
      link: 'https://misnet.harding.edu/testinglab/index.php',
      type: 'EXTERNAL'
    },
    {
      name: 'Public safety',
      link: 'http://www.harding.edu/public-safety',
      type: 'EXTERNAL'
    },
    {
      name: 'Parking registration',
      link: 'http://www.harding.edu/public-safety/parking-registration',
      type: 'EXTERNAL'
    },
    {
      name: 'Registrar',
      link: 'http://www.harding.edu/registrar',
      type: 'EXTERNAL'
    },
    {
      name: 'Bookstore',
      link: 'http://hubookstore.harding.edu/home.aspx',
      type: 'EXTERNAL'
    },
    {
      name: 'Career search',
      link: 'http://www.harding.edu/academics/academic-support/career/jobsearch',
      type: 'EXTERNAL',
      terms: [
        'Bison'
      ]
    },
    {
      name: 'Counseling center',
      link: 'http://www.harding.edu/academics/colleges-departments/bible-ministry/centers/christian-counseling/counseling-center',
      type: 'EXTERNAL'
    },
    {
      name: 'Health services',
      link: 'http://www.harding.edu/student-life/healthservices',
      type: 'EXTERNAL'
    },
    {
      name: 'Harding Homepage',
      link: 'http://www.harding.edu/',
      type: 'EXTERNAL'
    },
    {
      name: 'Pipeline',
      link: 'https://pipeline-old.harding.edu',
      type: 'EXTERNAL'
    },
    {
      name: 'New Pipeline',
      link: 'https://pipeline.harding.edu',
      type: 'EXTERNAL'
    },
    {
      name: 'Canvas',
      link: 'https://harding.instructure.com/',
      type: 'EXTERNAL'
    },
    {
      name: 'Computer science portal',
      link: 'http://cs.harding.edu/',
      type: 'EXTERNAL'
    },
    {
      name: 'EASEL',
      link: 'https://cs.harding.edu/easel/cgi-bin/index',
      type: 'EXTERNAL'
    },
    {
      name: 'Microsoft IMAGINE',
      link: 'http://e5.onthehub.com/WebStore/ProductsByMajorVersionList.aspx?ws=5bbb0d2d-3770-e011-971f-0030487d8897&vsro=8&JSEnabled=1',
      type: 'EXTERNAL'
    },
    {
      name: 'Campus Dish',
      link: 'https://harding.campusdish.com/',
      terms: [
        'Cafeteria',
        'Meal'
      ],
      type: 'EXTERNAL'
    },
    {
      name: 'SafeConnect Dashboard',
      link: 'https://10.5.1.1:8443/dashboard.do',
      terms: [
        'DormNet'
      ],
      type: 'EXTERNAL'
    },
    {
      name: 'Q Ware',
      link: 'https://www2.quecentre.com/harding/Login.aspx?ReturnUrl=%2fharding%2fDashboard.aspx',
      terms: [
        'DormNet'
      ],
      type: 'EXTERNAL'
    },
    {
      name: 'Harding Wiki',
      link: 'https://kenobi.harding.edu/dashboard.action',
      terms: [
        'Kenobi',
        'DormNet'
      ],
      type: 'EXTERNAL'
    },
    {
      name: 'Password change',
      link: 'https://password.harding.edu/',
      terms: [
        'DormNet'
      ],
      type: 'EXTERNAL'
    },
    {
      name: 'Teleinfo',
      link: 'http://misnet.harding.edu/teleinfo',
      terms: [
        'DormNet'
      ],
      type: 'EXTERNAL'
    },
    {
      name: 'DormNet blog',
      link: 'http://dormnet.blogspot.com/',
      type: 'EXTERNAL'
    },
    {
      name: 'Harding library',
      link: 'https://www.harding.edu/library',
      type: 'EXTERNAL'
    },
    {
      name: 'Harding Gmail',
      link: 'https://pipeline.harding.edu/email',
      type: 'EXTERNAL'
    }
  ]
}
