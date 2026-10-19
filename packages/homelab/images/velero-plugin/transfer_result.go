package plugin

import (
	"errors"
	"sync"
)

func completedTransfer(wg *sync.WaitGroup, completed <-chan bool, nativeErr error) error {
	wg.Wait()
	ok := <-completed
	if nativeErr != nil {
		return nativeErr
	}
	if !ok {
		return errors.New("zfs: cloud stream transfer failed")
	}
	return nil
}

func publishCompletedTransfer(wg *sync.WaitGroup, completed <-chan bool, publish func() error) error {
	if err := completedTransfer(wg, completed, nil); err != nil {
		return err
	}
	return publish()
}
