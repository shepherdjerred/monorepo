import {connect} from 'react-redux';
import {compose} from 'redux';
import { fetchTermList } from '../../../../../store/terms/read/actions';
import TermList from './TermList';
import WithLoadingIndicator from '../../../../util/hoc/WithLoadingIndicator';

export const mapStateToProps = function (state) {
  return {
    isFetching: state.terms.read.isFetching,
    terms: state.terms.read.items,
    error: state.terms.read.error
  };
};

const mapDispatchToProps = function (dispatch) {
  return {
    onFetch: () => {
      dispatch(fetchTermList());
    }
  };
};

const enhance = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  ),
  WithLoadingIndicator
);

export default enhance(TermList);
